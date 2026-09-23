package com.orcaspike.companion

/** Process-local replay window; it provides no durable mutation guarantee. */
class PingRequestDeduper(private val capacity: Int = 32) {
    private val seen = LinkedHashSet<String>()

    @Synchronized
    fun observe(requestId: String): Boolean {
        val isDuplicate = !seen.add(requestId)
        if (isDuplicate) {
            seen.remove(requestId)
            seen.add(requestId)
        } else if (seen.size > capacity) {
            val oldest = seen.iterator().next()
            seen.remove(oldest)
        }
        return isDuplicate
    }
}
