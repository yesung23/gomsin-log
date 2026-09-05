package app.gomsinlog.ondevicebriefing

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Android keeps the JavaScript bridge contract but deliberately has no model provider.
 * Google Play packaging is out of scope for the iOS-first release, so Android callers
 * receive the same unsupported signal as every other unavailable provider and retain
 * the deterministic briefing path.
 */
@CapacitorPlugin(name = "GomsinlogOnDeviceBriefing")
class OnDeviceBriefingPlugin : Plugin() {

    @PluginMethod
    fun availability(call: PluginCall) {
        if (call.data.keys().asSequence().toSet() != setOf("locale")) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        call.resolve(JSObject().apply {
            put("availability", "unsupported")
        })
    }

    @PluginMethod
    fun capability(call: PluginCall) {
        if (call.data.keys().hasNext()) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val envelope = JSObject().apply {
            put("maxContextUtf8Bytes", 4096)
            put("promptOverheadUtf8Bytes", 512)
            put("responseReserveUtf8Bytes", 1024)
            put("maxInputTextGraphemes", 1000)
            put("maxItems", 64)
            put("maxCandidatesPerItem", 32)
        }
        call.resolve(JSObject().apply { put("envelope", envelope) })
    }

    @PluginMethod
    fun selectExtracts(call: PluginCall) {
        reject(call, BriefingErrorCode.UNAVAILABLE)
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        if (call.data.keys().asSequence().toSet() != setOf("requestId")) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }

        val requestId = call.getString("requestId")
        if (requestId.isNullOrEmpty() || requestId.toByteArray(Charsets.UTF_8).size > 128) {
            reject(call, BriefingErrorCode.BAD_REQUEST)
            return
        }
        call.resolve(JSObject())
    }

    private fun reject(call: PluginCall, errorCode: BriefingErrorCode) {
        call.reject(errorCode.defaultMessage, errorCode.code)
    }
}

private enum class BriefingErrorCode(val code: String, val defaultMessage: String) {
    UNAVAILABLE("E_UNAVAILABLE", "on-device briefing unavailable"),
    BAD_REQUEST("E_BAD_REQUEST", "request is outside the contract")
}
