package expo.modules.orcawear

internal fun admitsHostPageSend(metadata: WearEnvelopeMetadata,
    published: PublishedWearDashboard?, action: WearJournalRecord?, now: Long): Boolean =
    published?.publisherEpoch == metadata.publisherEpoch &&
        published.revision == metadata.revision &&
        action?.bindingId == metadata.bindingId &&
        action.requestId == metadata.requestId &&
        action.actionName == "readHostPage" &&
        action.state == "effect_started" &&
        action.expiresAt > now
