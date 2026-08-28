package app.gomsinlog.ondevicebriefing

import android.icu.text.BreakIterator
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Capacitor bridge for On-Device Partner Briefing selection on Android.
 *
 * Bridge Name: GomsinlogOnDeviceBriefing
 * Methods:
 * - availability
 * - capability
 * - selectExtracts
 * - cancel
 */
@CapacitorPlugin(name = "GomsinlogOnDeviceBriefing")
class OnDeviceBriefingPlugin : Plugin() {

    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val engine = OnDeviceBriefingEngine(pluginScope)

    @PluginMethod
    fun availability(call: PluginCall) {
        val keys = call.data.keys().asSequence().toSet()
        if (keys != setOf("locale")) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            val ret = JSObject()
            ret.put("availability", OnDeviceBriefingAvailability.UNSUPPORTED.value)
            call.resolve(ret)
            return
        }

        val locale = call.getString("locale") ?: ""
        pluginScope.launch {
            val status = engine.checkAvailability(locale)
            val ret = JSObject()
            ret.put("availability", status.value)
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun capability(call: PluginCall) {
        val keys = call.data.keys().asSequence().toSet()
        if (keys.isNotEmpty()) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val envelope = JSObject().apply {
            put("maxContextUtf8Bytes", OnDeviceBriefing.MAX_CONTEXT_UTF8_BYTES)
            put("promptOverheadUtf8Bytes", OnDeviceBriefing.PROMPT_OVERHEAD_UTF8_BYTES)
            put("responseReserveUtf8Bytes", OnDeviceBriefing.RESPONSE_RESERVE_UTF8_BYTES)
            put("maxInputTextGraphemes", OnDeviceBriefing.MAX_INPUT_TEXT_GRAPHEMES)
        }
        val ret = JSObject().apply {
            put("envelope", envelope)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun selectExtracts(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            reject(call, BriefingErrorCode.UNAVAILABLE)
            return
        }

        val keys = call.data.keys().asSequence().toSet()
        if (keys != setOf("requestId", "locale", "items")) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val requestId = call.getString("requestId")
        val locale = call.getString("locale")
        val itemsArray = call.getArray("items")

        if (requestId.isNullOrEmpty() ||
            requestId.toByteArray(Charsets.UTF_8).size > 128 ||
            locale.isNullOrEmpty() ||
            !OnDeviceBriefing.isLocaleSupported(locale) ||
            itemsArray == null
        ) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val parsed = parseItems(itemsArray)
        if (parsed == null) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        pluginScope.launch {
            try {
                val choices = engine.select(
                    requestId,
                    locale,
                    parsed.items,
                    parsed.jsonString
                )

                val choicesJsArray = JSArray()
                for (choice in choices) {
                    val choiceObj = JSObject().apply {
                        put("itemOrdinal", choice.itemOrdinal)
                        put("candidateOrdinal", choice.candidateOrdinal)
                    }
                    choicesJsArray.put(choiceObj)
                }

                val outputObj = JSObject().apply {
                    put("version", 1)
                    put("choices", choicesJsArray)
                }

                val result = JSObject().apply {
                    put("requestId", requestId)
                    put("output", outputObj)
                }
                call.resolve(result)
            } catch (e: OnDeviceBriefingException) {
                reject(call, e.errorCode)
            } catch (_: Throwable) {
                reject(call, BriefingErrorCode.NATIVE_ERROR)
            }
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val keys = call.data.keys().asSequence().toSet()
        if (keys != setOf("requestId")) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val requestId = call.getString("requestId")
        if (requestId.isNullOrEmpty() || requestId.toByteArray(Charsets.UTF_8).size > 128) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }
        engine.cancel(requestId)
        call.resolve(JSObject())
    }

    override fun handleOnDestroy() {
        engine.cancelAll()
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    private data class ParsedItems(
        val items: List<BriefingItem>,
        val jsonString: String
    )

    private fun parseItems(rawItems: JSArray): ParsedItems? {
        if (rawItems.length() == 0 || rawItems.length() > OnDeviceBriefing.MAX_ITEMS) {
            return null
        }

        val items = ArrayList<BriefingItem>(rawItems.length())
        val jsonItems = JSONArray()
        var totalGraphemes = 0

        for (i in 0 until rawItems.length()) {
            val itemObj = rawItems.optJSONObject(i) ?: return null

            val keys = itemObj.keys().asSequence().toSet()
            if (keys != setOf("itemOrdinal", "candidates")) {
                return null
            }

            val itemOrdinalVal = itemObj.opt("itemOrdinal")
            if (itemOrdinalVal !is Int && (itemOrdinalVal !is Number || itemOrdinalVal.toDouble() != itemOrdinalVal.toInt().toDouble())) {
                return null
            }
            val itemOrdinal = (itemOrdinalVal as Number).toInt()
            if (itemOrdinal != i) {
                return null
            }

            val candidatesArray = itemObj.optJSONArray("candidates") ?: return null
            if (candidatesArray.length() == 0 || candidatesArray.length() > OnDeviceBriefing.MAX_CANDIDATES_PER_ITEM) {
                return null
            }

            val candidates = ArrayList<BriefingCandidate>(candidatesArray.length())
            val jsonCandidates = JSONArray()

            for (c in 0 until candidatesArray.length()) {
                val candidateObj = candidatesArray.optJSONObject(c) ?: return null
                val candidateKeys = candidateObj.keys().asSequence().toSet()
                if (candidateKeys != setOf("candidateOrdinal", "text")) {
                    return null
                }

                val candidateOrdinalVal = candidateObj.opt("candidateOrdinal")
                if (candidateOrdinalVal !is Int && (candidateOrdinalVal !is Number || candidateOrdinalVal.toDouble() != candidateOrdinalVal.toInt().toDouble())) {
                    return null
                }
                val candidateOrdinal = (candidateOrdinalVal as Number).toInt()
                if (candidateOrdinal != c) {
                    return null
                }

                val rawText = candidateObj.opt("text")
                if (rawText !is String) {
                    return null
                }
                val text = rawText
                if (text.trim().isEmpty()) {
                    return null
                }

                val graphemes = countGraphemes(text)
                totalGraphemes += graphemes
                if (totalGraphemes > OnDeviceBriefing.MAX_INPUT_TEXT_GRAPHEMES) {
                    return null
                }

                candidates.add(BriefingCandidate(candidateOrdinal, text))
                val jsonCandidate = JSONObject().apply {
                    put("candidateOrdinal", candidateOrdinal)
                    put("text", text)
                }
                jsonCandidates.put(jsonCandidate)
            }

            items.add(BriefingItem(itemOrdinal, candidates))
            val jsonItem = JSONObject().apply {
                put("itemOrdinal", itemOrdinal)
                put("candidates", jsonCandidates)
            }
            jsonItems.put(jsonItem)
        }

        val jsonString = jsonItems.toString()
        val utf8Bytes = jsonString.toByteArray(Charsets.UTF_8).size
        if (utf8Bytes + OnDeviceBriefing.PROMPT_OVERHEAD_UTF8_BYTES + OnDeviceBriefing.RESPONSE_RESERVE_UTF8_BYTES > OnDeviceBriefing.MAX_CONTEXT_UTF8_BYTES) {
            return null
        }

        return ParsedItems(items, jsonString)
    }

    private fun countGraphemes(text: String): Int {
        val it = BreakIterator.getCharacterInstance()
        it.setText(text)
        var count = 0
        while (it.next() != BreakIterator.DONE) {
            count++
        }
        return count
    }

    private fun reject(call: PluginCall, errorCode: BriefingErrorCode) {
        call.reject(errorCode.defaultMessage, errorCode.code)
    }
}
