import { StyleSheet, Text, View } from 'react-native'
import type { WearConversationPage } from '../packages/wear-companion-contract/src/conversation-page'
import { WearButton } from './wear-button'
import { wearColors } from './wear-theme'

export function ConversationView({
  title,
  status,
  page,
  reason,
  onBack,
  onRetry
}: {
  title: string
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  page: WearConversationPage | null
  reason: 'rejected' | 'timeout' | 'unavailable' | null
  onBack: () => void
  onRetry: () => void
}) {
  return (
    <View style={styles.section}>
      <WearButton label="Back to agents" quiet onPress={onBack} />
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {status === 'loading' || status === 'idle' ? (
        <Text style={styles.detail}>Reading conversation from phone…</Text>
      ) : null}
      {status === 'unavailable' ? (
        <>
          <Text accessibilityRole="alert" style={styles.detail}>
            {reason === 'rejected'
              ? 'The selected agent changed or this conversation is unavailable.'
              : 'Phone conversation response unavailable.'}
          </Text>
          <WearButton label="Try again" onPress={onRetry} />
        </>
      ) : null}
      {status === 'ready' && page ? (
        <>
          <Text style={styles.detail}>
            Recent text preview · {page.kind === 'structured' ? 'Structured' : 'Terminal'}
          </Text>
          {page.messages.length === 0 ? (
            <Text style={styles.detail}>No recent text messages.</Text>
          ) : null}
          {page.messages.map((message) => (
            <View key={message.id} style={styles.card}>
              <Text style={styles.role}>{message.role === 'user' ? 'User' : 'Agent'}</Text>
              <Text style={styles.message}>{message.text}</Text>
              {message.truncated ? (
                <Text style={styles.detail}>Message shortened for watch.</Text>
              ) : null}
            </View>
          ))}
          {page.hasOlder ? (
            <Text style={styles.detail}>Earlier messages are outside this preview.</Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { width: '100%', alignItems: 'center', gap: 10 },
  heading: { color: wearColors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  detail: { color: wearColors.secondary, fontSize: 12, textAlign: 'center', marginTop: 6 },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: wearColors.raised,
    borderWidth: 1,
    borderColor: wearColors.border
  },
  role: { color: wearColors.secondary, fontSize: 12, fontWeight: '600' },
  message: { color: wearColors.text, fontSize: 14, marginTop: 6 }
})
