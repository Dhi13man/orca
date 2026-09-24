import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { WearHandoffTarget } from '../../../../src/notifications/notification-routing'
import {
  readWearStructuredPhoneConversation,
  type WearStructuredPhoneConversationResult
} from '../../../../src/wear/wear-structured-phone-conversation'
import { colors, radii, spacing, typography } from '../../../../src/theme/mobile-theme'

export default function WearStructuredConversationScreen() {
  const router = useRouter()
  const {
    hostId,
    worktreeId,
    requestId,
    sessionTabId,
    workspaceKind,
    targetPublicationEpoch,
    targetSnapshotVersion
  } = useLocalSearchParams<{
    hostId: string
    worktreeId: string
    requestId?: string
    sessionTabId?: string
    workspaceKind?: string
    targetPublicationEpoch?: string
    targetSnapshotVersion?: string
  }>()
  const [reload, setReload] = useState(0)
  const [read, setRead] = useState<{
    key: string
    result: WearStructuredPhoneConversationResult
  } | null>(null)
  const target = useMemo<WearHandoffTarget | null>(() => {
    if (
      !hostId ||
      !worktreeId ||
      !requestId ||
      !sessionTabId ||
      !targetPublicationEpoch ||
      (workspaceKind !== 'worktree' && workspaceKind !== 'folder') ||
      !/^(0|[1-9]\d*)$/.test(targetSnapshotVersion ?? '')
    ) {
      return null
    }
    const version = Number(targetSnapshotVersion)
    if (!Number.isSafeInteger(version)) {
      return null
    }
    return {
      hostId,
      workspaceId: worktreeId,
      requestId,
      sessionTabId,
      workspaceKind,
      targetPublicationEpoch,
      targetSnapshotVersion: version,
      kind: 'structured'
    }
  }, [
    hostId,
    worktreeId,
    requestId,
    sessionTabId,
    workspaceKind,
    targetPublicationEpoch,
    targetSnapshotVersion
  ])
  const targetKey = target
    ? JSON.stringify([
        target.hostId,
        target.workspaceId,
        target.workspaceKind,
        target.sessionTabId,
        target.targetPublicationEpoch,
        target.targetSnapshotVersion,
        target.requestId,
        reload
      ])
    : null
  const result = read?.key === targetKey ? read.result : null

  useEffect(() => {
    if (!target || !targetKey) {
      return
    }
    let active = true
    void readWearStructuredPhoneConversation(target).then((next) => {
      if (active) {
        setRead({ key: targetKey, result: next })
      }
    })
    return () => {
      active = false
    }
  }, [target, targetKey])

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.action}>Back</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          Agent conversation
        </Text>
        <Text style={styles.meta}>Structured agent · read-only text preview</Text>
        {!target ? (
          <Text accessibilityRole="alert" style={styles.detail}>
            Invalid handoff target.
          </Text>
        ) : !result ? (
          <Text style={styles.detail}>Reading from paired host…</Text>
        ) : result.state !== 'ready' ? (
          <Text accessibilityRole="alert" style={styles.detail}>
            {result.state === 'target-changed'
              ? 'This agent changed. Open it again from the watch.'
              : 'Conversation unavailable. Check the paired host and try again.'}
          </Text>
        ) : (
          <View style={styles.messages}>
            {result.messages.length === 0 ? (
              <Text style={styles.detail}>No recent text messages.</Text>
            ) : null}
            {result.messages.map((message) => (
              <View key={message.id} style={styles.message}>
                <Text style={styles.meta}>{message.role === 'user' ? 'You' : 'Agent'}</Text>
                <Text selectable style={styles.body}>
                  {message.text}
                </Text>
                {message.truncated ? <Text style={styles.meta}>Message shortened.</Text> : null}
              </View>
            ))}
            {result.hasOlder ? (
              <Text style={styles.detail}>Earlier messages are outside this preview.</Text>
            ) : null}
          </View>
        )}
        {target ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReload((value) => value + 1)}
            style={styles.refresh}
          >
            <Text style={styles.action}>Refresh conversation</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: spacing.lg, gap: spacing.md },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: typography.metaSize },
  detail: { color: colors.textSecondary, fontSize: typography.bodySize },
  action: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  messages: { gap: spacing.md },
  message: {
    padding: spacing.md,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.sm
  },
  body: { color: colors.textPrimary, fontSize: typography.bodySize },
  refresh: { alignSelf: 'flex-start', paddingVertical: spacing.sm }
})
