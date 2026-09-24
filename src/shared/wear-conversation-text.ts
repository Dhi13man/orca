import type { NativeChatMessage } from './native-chat-types'

export type WearConversationTextMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  truncated: boolean
  observedAt: number | null
}

export function clippedWearConversationText(blocks: NativeChatMessage['blocks']): {
  text: string
  truncated: boolean
} {
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > 2_048) {
      break
    }
    bytes += size
    end += character.length
  }
  return { text: text.slice(0, end), truncated: end < text.length }
}

export function boundWearConversationMessages(messages: WearConversationTextMessage[]): {
  messages: WearConversationTextMessage[]
  clipped: boolean
} {
  const selected = messages.slice(-20)
  let clipped = selected.length !== messages.length
  while (Buffer.byteLength(JSON.stringify(selected), 'utf8') > 28_000) {
    selected.shift()
    clipped = true
  }
  return { messages: selected, clipped }
}

export function projectWearNativeChatMessages(
  messages: NativeChatMessage[],
  hasOlder: boolean
): { messages: WearConversationTextMessage[]; hasOlder: boolean } {
  const projected = messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return []
    }
    const text = clippedWearConversationText(message.blocks)
    return text.text
      ? [{ id: message.id, role: message.role, ...text, observedAt: message.timestamp }]
      : []
  })
  const result = boundWearConversationMessages(projected)
  return { messages: result.messages, hasOlder: hasOlder || result.clipped }
}
