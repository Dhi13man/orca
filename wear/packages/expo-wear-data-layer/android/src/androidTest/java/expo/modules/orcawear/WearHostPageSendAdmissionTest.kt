package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WearHostPageSendAdmissionTest {
    private val binding = UUID.randomUUID().toString()
    private val epoch = UUID.randomUUID().toString()
    private val metadata = WearEnvelopeMetadata(binding, WearEnvelopeKind.PAGE,
        epoch, 4, "request", 120_000)
    private val published = PublishedWearDashboard(epoch, 4, "path", 120_000)
    private val action = WearJournalRecord(binding, "request", "a".repeat(64),
        "readHostPage", "effect_started", 120_000, null)

    @Test fun admitsOnlyCurrentPublishedActionAtFinalSendBoundary() {
        assertTrue(admitsHostPageSend(metadata, published, action, 1))
        assertFalse(admitsHostPageSend(metadata, published.copy(revision = 5), action, 1))
        assertFalse(admitsHostPageSend(metadata, published.copy(publisherEpoch =
            UUID.randomUUID().toString()), action, 1))
        assertFalse(admitsHostPageSend(metadata, published, action, 120_000))
        assertFalse(admitsHostPageSend(metadata, published, action.copy(state = "unknown"), 1))
        assertFalse(admitsHostPageSend(metadata, published,
            action.copy(actionName = "sendAgentMessage"), 1))
    }
}
