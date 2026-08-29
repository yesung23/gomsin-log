package app.gomsinlog.ondevicebriefing

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for network download gating and decision logic in [OnDeviceBriefingEngine].
 *
 * Contract:
 * - Active network required
 * - Network capabilities non-null required
 * - NET_CAPABILITY_INTERNET required
 * - NET_CAPABILITY_VALIDATED required
 * - !isActiveNetworkMetered required (unmetered only)
 * - null / metered / unvalidated / no-internet / exception must all evaluate to false
 */
class OnDeviceBriefingEngineTest {

    private val testScope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @Test
    fun networkEligibleWhenValidatedInternetAndUnmetered() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = true,
            hasCapabilities = true,
            hasInternetCapability = true,
            hasValidatedCapability = true,
            isMetered = false
        )
        assertTrue("Validated unmetered internet connection must be eligible for download", eligible)
    }

    @Test
    fun networkIneligibleWhenUnvalidated() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = true,
            hasCapabilities = true,
            hasInternetCapability = true,
            hasValidatedCapability = false,
            isMetered = false
        )
        assertFalse("Unvalidated network (e.g. captive portal) must NOT be eligible for download", eligible)
    }

    @Test
    fun networkIneligibleWhenNoInternetCapability() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = true,
            hasCapabilities = true,
            hasInternetCapability = false,
            hasValidatedCapability = true,
            isMetered = false
        )
        assertFalse("Network lacking INTERNET capability must NOT be eligible for download", eligible)
    }

    @Test
    fun networkIneligibleWhenMetered() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = true,
            hasCapabilities = true,
            hasInternetCapability = true,
            hasValidatedCapability = true,
            isMetered = true
        )
        assertFalse("Metered network (e.g. cellular / metered Wi-Fi) must NOT be eligible for download", eligible)
    }

    @Test
    fun networkIneligibleWhenNoActiveNetwork() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = false,
            hasCapabilities = true,
            hasInternetCapability = true,
            hasValidatedCapability = true,
            isMetered = false
        )
        assertFalse("Absence of active network must NOT be eligible for download", eligible)
    }

    @Test
    fun networkIneligibleWhenCapabilitiesNull() {
        val eligible = OnDeviceBriefingEngine.isNetworkEligibleForDownload(
            hasActiveNetwork = true,
            hasCapabilities = false,
            hasInternetCapability = false,
            hasValidatedCapability = false,
            isMetered = false
        )
        assertFalse("Null network capabilities must NOT be eligible for download", eligible)
    }

    @Test
    fun isUnmeteredActiveNetworkReturnsFalseOnException() {
        val engine = OnDeviceBriefingEngine(
            scope = testScope,
            context = null,
            isUnmeteredNetworkProvider = { throw RuntimeException("Simulated ConnectivityManager failure") }
        )
        assertFalse("Any exception during network check must fail-closed to false", engine.isUnmeteredActiveNetwork())
    }

    @Test
    fun isUnmeteredActiveNetworkReturnsTrueWhenProviderReportsTrue() {
        val engine = OnDeviceBriefingEngine(
            scope = testScope,
            context = null,
            isUnmeteredNetworkProvider = { true }
        )
        assertTrue("Network provider returning true must result in true", engine.isUnmeteredActiveNetwork())
    }

    @Test
    fun isUnmeteredActiveNetworkReturnsFalseWhenProviderReportsFalse() {
        val engine = OnDeviceBriefingEngine(
            scope = testScope,
            context = null,
            isUnmeteredNetworkProvider = { false }
        )
        assertFalse("Network provider returning false must result in false", engine.isUnmeteredActiveNetwork())
    }

    @Test
    fun isUnmeteredActiveNetworkReturnsFalseWhenContextIsNullAndNoProvider() {
        val engine = OnDeviceBriefingEngine(
            scope = testScope,
            context = null,
            isUnmeteredNetworkProvider = null
        )
        assertFalse("Null context without provider must evaluate to false", engine.isUnmeteredActiveNetwork())
    }
}
