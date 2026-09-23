package com.orcaspike.companion

import android.app.Activity
import android.os.Bundle
import android.util.Log

/** Bounded Phase 0 spike: confirms cold-start native entry only. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i("OrcaSpikeWatch", "native entry reached: MainActivity.onCreate")
    }
}
