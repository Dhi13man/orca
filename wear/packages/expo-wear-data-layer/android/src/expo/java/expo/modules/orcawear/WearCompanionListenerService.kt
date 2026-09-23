package expo.modules.orcawear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

class WearCompanionListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        WearCompanionOwner.get(applicationContext).receive(event.sourceNodeId, event.path, event.data)
    }
}
