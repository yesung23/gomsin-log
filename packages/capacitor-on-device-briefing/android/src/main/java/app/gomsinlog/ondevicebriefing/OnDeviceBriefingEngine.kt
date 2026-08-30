package app.gomsinlog.ondevicebriefing

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.icu.text.BreakIterator
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.GenerateContentRequest
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.TextPart
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Data structures representing candidate extractions, items, groups, and choices.
 * These structures contain only ordinals and candidate text — no user identifiers,
 * timestamps, keys, or metadata are ever accepted or processed.
 */
data class BriefingCandidate(
    val candidateOrdinal: Int,
    val text: String
)

data class BriefingItem(
    val itemOrdinal: Int,
    val candidates: List<BriefingCandidate>
)

data class BriefingChoice(
    val itemOrdinal: Int,
    val candidateOrdinal: Int
)

data class BriefingGroup(
    val groupOrdinal: Int,
    val choices: List<BriefingChoice>
)

enum class OnDeviceBriefingAvailability(val value: String) {
    READY("ready"),
    UNSUPPORTED("unsupported"),
    MODEL_UNAVAILABLE("model_unavailable"),
    PREPARING("preparing"),
    LOCALE_UNSUPPORTED("locale_unsupported")
}

enum class BriefingErrorCode(val code: String, val defaultMessage: String) {
    UNAVAILABLE("E_UNAVAILABLE", "on-device briefing unavailable"),
    BAD_REQUEST("E_BAD_REQUEST", "request is outside the contract"),
    MALFORMED("E_MALFORMED", "on-device briefing returned an unusable shape"),
    BUSY("E_BUSY", "on-device briefing is busy"),
    QUOTA("E_QUOTA", "on-device briefing quota unavailable"),
    CANCELLED("E_CANCELLED", "on-device briefing was cancelled"),
    NATIVE_ERROR("E_NATIVE", "on-device briefing failed")
}

class OnDeviceBriefingException(val errorCode: BriefingErrorCode) : Exception(errorCode.defaultMessage)

object OnDeviceBriefing {
    const val MAX_CONTEXT_UTF8_BYTES = 4096
    const val PROMPT_OVERHEAD_UTF8_BYTES = 512
    const val RESPONSE_RESERVE_UTF8_BYTES = 1024
    const val MAX_INPUT_TEXT_GRAPHEMES = 1000
    const val MAX_ITEMS = 64
    const val MAX_CANDIDATES_PER_ITEM = 32
    const val MAXIMUM_RESPONSE_TOKENS = 512

    const val INSTRUCTIONS = "Group contiguous items into groups (prefer 2–4 items per group, singleton only when N=1). Choose one supplied candidate for every item. Return only groupOrdinal, itemOrdinal, and candidateOrdinal in JSON format: {\"version\":2,\"groups\":[{\"groupOrdinal\":0,\"choices\":[{\"itemOrdinal\":0,\"candidateOrdinal\":0}]}]}. Keep every item once and in order across groups. Never write markdown, commentary, or text outside the JSON object."

    val ACTUAL_PROMPT_OVERHEAD_UTF8_BYTES = (INSTRUCTIONS + "\n\nItems JSON:\n").toByteArray(Charsets.UTF_8).size

    init {
        check(ACTUAL_PROMPT_OVERHEAD_UTF8_BYTES <= PROMPT_OVERHEAD_UTF8_BYTES) {
            "Prompt overhead exceeds allocated budget"
        }
    }

    fun isLocaleSupported(locale: String): Boolean {
        return locale == "ko" || locale == "en"
    }

    fun prompt(itemsJSON: String): String {
        return "$INSTRUCTIONS\n\nItems JSON:\n$itemsJSON"
    }
}

/**
 * Android on-device briefing execution engine backed by Google ML Kit GenAI Prompt API.
 *
 * All operations are strictly runtime-gated to Android 8.0 (API 26+) because the underlying
 * Prompt API requires API 26.
 *
 * Privacy & Security Constraints:
 * - Fresh GenerativeModel per inference, closed immediately in finally block.
 * - Deduplicated model download uses a separate fresh client and closes it upon completion.
 * - Prompt inference is fully on-device; model asset download is on-demand via ML Kit/AICore.
 * - No persistent prompt cache, transcript, external network requests, or analytics.
 * - No user identity (record identifiers, user or couple identifiers, etc.) crosses into the model prompt.
 * - Error mapping switches on e.errorCode constants and never inspects raw exception messages.
 * - Zero logging (no Log.d/w/e or println).
 */
class OnDeviceBriefingEngine(
    private val scope: CoroutineScope,
    private val context: Context? = null,
    private val isUnmeteredNetworkProvider: (() -> Boolean)? = null
) {
    private val inFlight = ConcurrentHashMap<String, Deferred<List<BriefingGroup>>>()
    private val isDownloading = AtomicBoolean(false)

    fun countGraphemes(text: String): Int {
        val it = BreakIterator.getCharacterInstance()
        it.setText(text)
        var count = 0
        while (it.next() != BreakIterator.DONE) {
            count++
        }
        return count
    }

    fun isUnmeteredActiveNetwork(): Boolean {
        if (isUnmeteredNetworkProvider != null) {
            return try {
                isUnmeteredNetworkProvider.invoke()
            } catch (_: Throwable) {
                false
            }
        }
        val ctx = context ?: return false
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            val activeNetwork = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
            val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val hasValidated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            val isMetered = cm.isActiveNetworkMetered
            isNetworkEligibleForDownload(
                hasActiveNetwork = true,
                hasCapabilities = true,
                hasInternetCapability = hasInternet,
                hasValidatedCapability = hasValidated,
                isMetered = isMetered
            )
        } catch (_: Throwable) {
            false
        }
    }

    suspend fun checkAvailability(locale: String): OnDeviceBriefingAvailability {
        if (!OnDeviceBriefing.isLocaleSupported(locale)) {
            return OnDeviceBriefingAvailability.LOCALE_UNSUPPORTED
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return OnDeviceBriefingAvailability.UNSUPPORTED
        }
        return try {
            checkMlKitAvailability()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            OnDeviceBriefingAvailability.MODEL_UNAVAILABLE
        }
    }

    private suspend fun checkMlKitAvailability(): OnDeviceBriefingAvailability {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return OnDeviceBriefingAvailability.UNSUPPORTED
        }
        val model = Generation.getClient()
        return try {
            val status = model.checkStatus()
            when (status) {
                FeatureStatus.AVAILABLE -> OnDeviceBriefingAvailability.READY
                FeatureStatus.DOWNLOADABLE -> {
                    if (isUnmeteredActiveNetwork()) {
                        triggerDownload()
                    }
                    OnDeviceBriefingAvailability.PREPARING
                }
                FeatureStatus.DOWNLOADING -> OnDeviceBriefingAvailability.PREPARING
                FeatureStatus.UNAVAILABLE -> OnDeviceBriefingAvailability.MODEL_UNAVAILABLE
                else -> OnDeviceBriefingAvailability.MODEL_UNAVAILABLE
            }
        } finally {
            model.close()
        }
    }

    private fun triggerDownload() {
        if (isDownloading.compareAndSet(false, true)) {
            scope.launch {
                val downloadModel = Generation.getClient()
                try {
                    downloadModel.download().collect { }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    // Retry on next availability check
                } finally {
                    try {
                        downloadModel.close()
                    } catch (_: Throwable) {}
                    isDownloading.set(false)
                }
            }
        }
    }

    /**
     * Registers the only Deferred for this request before starting any inference.
     * The Capacitor bridge calls this synchronously, so a following cancel call
     * cannot arrive before request ownership exists in [inFlight].
     */
    fun startSelect(
        requestId: String,
        locale: String,
        items: List<BriefingItem>,
        itemsJSON: String
    ): Deferred<List<BriefingGroup>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            throw OnDeviceBriefingException(BriefingErrorCode.UNAVAILABLE)
        }

        val deferred = scope.async(start = CoroutineStart.LAZY) {
            val currentAvailability = checkAvailability(locale)
            if (currentAvailability != OnDeviceBriefingAvailability.READY) {
                throw OnDeviceBriefingException(BriefingErrorCode.UNAVAILABLE)
            }
            runMlKitInference(items, itemsJSON)
        }

        val existing = inFlight.putIfAbsent(requestId, deferred)
        if (existing != null) {
            deferred.cancel()
            throw OnDeviceBriefingException(BriefingErrorCode.BUSY)
        }

        deferred.invokeOnCompletion {
            inFlight.remove(requestId, deferred)
        }
        deferred.start()
        return deferred
    }

    private suspend fun runMlKitInference(
        items: List<BriefingItem>,
        itemsJSON: String
    ): List<BriefingGroup> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            throw OnDeviceBriefingException(BriefingErrorCode.UNAVAILABLE)
        }
        val promptText = OnDeviceBriefing.prompt(itemsJSON)
        val request = GenerateContentRequest.Builder(TextPart(promptText)).apply {
            temperature = 0f
            seed = 0
            topK = 1
            candidateCount = 1
            maxOutputTokens = OnDeviceBriefing.MAXIMUM_RESPONSE_TOKENS
        }.build()

        val model = Generation.getClient()
        try {
            currentCoroutineContext().ensureActive()
            val response = try {
                model.generateContent(request)
            } catch (e: CancellationException) {
                throw e
            } catch (e: GenAiException) {
                throw mapGenAiException(e)
            } catch (_: Throwable) {
                throw OnDeviceBriefingException(BriefingErrorCode.NATIVE_ERROR)
            }

            currentCoroutineContext().ensureActive()
            val rawOutput = response.candidates.firstOrNull()?.text?.trim()
                ?: throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            if (rawOutput.toByteArray(Charsets.UTF_8).size > OnDeviceBriefing.RESPONSE_RESERVE_UTF8_BYTES) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }
            return parseAndValidatePlan(rawOutput, items)
        } finally {
            model.close()
        }
    }

    private fun parseAndValidatePlan(
        rawOutput: String,
        items: List<BriefingItem>
    ): List<BriefingGroup> {
        if (!rawOutput.startsWith("{") || !rawOutput.endsWith("}")) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        val tokener = JSONTokener(rawOutput)
        val parsedValue = try {
            tokener.nextValue()
        } catch (_: Throwable) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        if (parsedValue !is JSONObject) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        // Strict end-of-input check
        if (tokener.more()) {
            val trailing = tokener.nextClean()
            if (trailing.code != 0) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }
        }

        val json = parsedValue
        val topKeys = json.keys().asSequence().toSet()
        if (topKeys != setOf("version", "groups")) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        val versionVal = json.opt("version")
        if (versionVal !is Int && (versionVal !is Number || versionVal.toDouble() != versionVal.toInt().toDouble())) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }
        if ((versionVal as Number).toInt() != 2) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        val groupsArray = json.optJSONArray("groups")
            ?: throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)

        if (items.isEmpty()) {
            if (groupsArray.length() != 0) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }
            return emptyList()
        }
        if (items.size == 1 && groupsArray.length() != 1) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }
        if (items.size >= 2 && groupsArray.length() == 0) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        val result = ArrayList<BriefingGroup>(groupsArray.length())
        var currentExpectedItemOrdinal = 0

        for (g in 0 until groupsArray.length()) {
            val groupObj = groupsArray.optJSONObject(g)
                ?: throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            val groupKeys = groupObj.keys().asSequence().toSet()
            if (groupKeys != setOf("groupOrdinal", "choices")) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }

            val groupOrdinalVal = groupObj.opt("groupOrdinal")
            if (groupOrdinalVal !is Int && (groupOrdinalVal !is Number || groupOrdinalVal.toDouble() != groupOrdinalVal.toInt().toDouble())) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }
            val groupOrdinal = (groupOrdinalVal as Number).toInt()
            if (groupOrdinal != g) {
                throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            }

            val choicesArray = groupObj.optJSONArray("choices")
                ?: throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)

            if (items.size == 1) {
                if (choicesArray.length() != 1) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }
            } else {
                if (choicesArray.length() < 2 || choicesArray.length() > 4) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }
            }

            val choices = ArrayList<BriefingChoice>(choicesArray.length())
            for (c in 0 until choicesArray.length()) {
                val choiceObj = choicesArray.optJSONObject(c)
                    ?: throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                val choiceKeys = choiceObj.keys().asSequence().toSet()
                if (choiceKeys != setOf("itemOrdinal", "candidateOrdinal")) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }

                val itemOrdinalVal = choiceObj.opt("itemOrdinal")
                val candidateOrdinalVal = choiceObj.opt("candidateOrdinal")

                if (itemOrdinalVal !is Int && (itemOrdinalVal !is Number || itemOrdinalVal.toDouble() != itemOrdinalVal.toInt().toDouble())) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }
                if (candidateOrdinalVal !is Int && (candidateOrdinalVal !is Number || candidateOrdinalVal.toDouble() != candidateOrdinalVal.toInt().toDouble())) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }

                val itemOrdinal = (itemOrdinalVal as Number).toInt()
                val candidateOrdinal = (candidateOrdinalVal as Number).toInt()

                if (itemOrdinal != currentExpectedItemOrdinal) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }
                if (itemOrdinal < 0 || itemOrdinal >= items.size) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }

                val candidateCount = items[itemOrdinal].candidates.size
                if (candidateOrdinal < 0 || candidateOrdinal >= candidateCount) {
                    throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
                }

                choices.add(BriefingChoice(itemOrdinal, candidateOrdinal))
                currentExpectedItemOrdinal++
            }

            result.add(BriefingGroup(groupOrdinal, choices))
        }

        if (currentExpectedItemOrdinal != items.size) {
            throw OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
        }

        return result
    }

    private fun mapGenAiException(e: GenAiException): OnDeviceBriefingException {
        return when (e.errorCode) {
            GenAiException.ErrorCode.BUSY ->
                OnDeviceBriefingException(BriefingErrorCode.BUSY)
            GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED ->
                OnDeviceBriefingException(BriefingErrorCode.QUOTA)
            GenAiException.ErrorCode.CANCELLED ->
                OnDeviceBriefingException(BriefingErrorCode.CANCELLED)
            GenAiException.ErrorCode.REQUEST_PROCESSING_ERROR,
            GenAiException.ErrorCode.RESPONSE_PROCESSING_ERROR,
            GenAiException.ErrorCode.REQUEST_TOO_LARGE,
            GenAiException.ErrorCode.REQUEST_TOO_SMALL,
            GenAiException.ErrorCode.RESPONSE_GENERATION_ERROR,
            GenAiException.ErrorCode.INVALID_INPUT_IMAGE,
            GenAiException.ErrorCode.CACHE_PROCESSING_ERROR ->
                OnDeviceBriefingException(BriefingErrorCode.MALFORMED)
            GenAiException.ErrorCode.NOT_AVAILABLE,
            GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE,
            GenAiException.ErrorCode.AICORE_INCOMPATIBLE,
            GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE,
            GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED ->
                OnDeviceBriefingException(BriefingErrorCode.UNAVAILABLE)
            else ->
                OnDeviceBriefingException(BriefingErrorCode.NATIVE_ERROR)
        }
    }

    fun cancel(requestId: String) {
        val job = inFlight.remove(requestId)
        job?.cancel()
    }

    fun cancelAll() {
        inFlight.values.forEach { it.cancel() }
        inFlight.clear()
    }

    companion object {
        internal fun isNetworkEligibleForDownload(
            hasActiveNetwork: Boolean,
            hasCapabilities: Boolean,
            hasInternetCapability: Boolean,
            hasValidatedCapability: Boolean,
            isMetered: Boolean
        ): Boolean {
            if (!hasActiveNetwork || !hasCapabilities) {
                return false
            }
            return hasInternetCapability && hasValidatedCapability && !isMetered
        }
    }
}
