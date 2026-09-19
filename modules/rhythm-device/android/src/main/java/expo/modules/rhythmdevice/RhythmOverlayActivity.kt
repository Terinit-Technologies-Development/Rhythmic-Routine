package expo.modules.rhythmdevice

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class RhythmOverlayActivity : Activity() {

    private val checkHandler = Handler(Looper.getMainLooper())
    private var targetPackage: String? = null
    private var cooldownEndsAt: Long = 0L

    private val autoCloseRunnable = object : Runnable {
        override fun run() {
            val pkg = targetPackage
            if (pkg != null) {
                val now = System.currentTimeMillis()
                if (!RhythmEnforcementService.isEffectivelyRestricted(this@RhythmOverlayActivity, pkg, now)) {
                    Log.i(TAG, "Restriction ended for $pkg; auto-closing Touch Grass overlay")
                    finish()
                    return
                }
            }
            checkHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        targetPackage = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_PACKAGE_NAME)
        cooldownEndsAt = intent?.getLongExtra(RhythmNativePolicyKeys.EXTRA_COOLDOWN_ENDS_AT, 0L) ?: 0L
        val groupName = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_GROUP_NAME) ?: "This Risk Group"
        val activityEmoji = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_EMOJI) ?: "🌱"
        val activityTitle = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_TITLE)
        val activitySubtitle = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_SUBTITLE)
        val activityDuration = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_DURATION)

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#FAF7F0"))
            setPadding(64, 64, 64, 64)
        }

        val emojiView = TextView(this).apply {
            text = activityEmoji
            textSize = 56f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 32)
        }

        val titleView = TextView(this).apply {
            text = "Touch Grass"
            textSize = 28f
            setTextColor(Color.parseColor("#164B38"))
            gravity = Gravity.CENTER
            paint.isFakeBoldText = true
            setPadding(0, 0, 0, 16)
        }

        val subtitleView = TextView(this).apply {
            text = if (cooldownEndsAt > 0L && activityTitle != null) {
                val duration = activityDuration?.let { " · $it" } ?: ""
                "$groupName has reached its shared allowance.\n\nTry this while your group resets:\n$activityEmoji $activityTitle\n${activitySubtitle ?: "Take a mindful offline break."}$duration"
            } else {
                "This app is paused by your current Rhythm window or recovery cooldown.\n\nReturn home for now, or open Rhythm to review your routine."
            }
            textSize = 15f
            setTextColor(Color.parseColor("#5A6B5C"))
            gravity = Gravity.CENTER
            setLineSpacing(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 4f, resources.displayMetrics), 1f)
            setPadding(0, 0, 0, 48)
        }

        val homeBtn = Button(this).apply {
            text = "Return to Home"
            setTextColor(Color.WHITE)
            textSize = 16f
            val bg = GradientDrawable().apply {
                setColor(Color.parseColor("#164B38"))
                cornerRadius = 999f
            }
            background = bg
            setPadding(48, 28, 48, 28)
            setOnClickListener {
                navigateHome()
            }
        }

        val openRhythmBtn = Button(this).apply {
            text = "Open Rhythm Routine"
            setTextColor(Color.parseColor("#164B38"))
            textSize = 14f
            background = null
            setPadding(32, 20, 32, 20)
            setOnClickListener {
                val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                if (launchIntent != null) {
                    launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    startActivity(launchIntent)
                }
                finish()
            }
        }

        rootLayout.addView(emojiView)
        rootLayout.addView(titleView)
        rootLayout.addView(subtitleView)
        rootLayout.addView(homeBtn)
        rootLayout.addView(openRhythmBtn)

        setContentView(rootLayout)
    }

    override fun onStart() {
        super.onStart()
        isVisible = true
    }

    override fun onResume() {
        super.onResume()
        isVisible = true
        checkHandler.removeCallbacks(autoCloseRunnable)
        checkHandler.postDelayed(autoCloseRunnable, 1000L)
    }

    override fun onPause() {
        checkHandler.removeCallbacks(autoCloseRunnable)
        super.onPause()
    }

    override fun onStop() {
        isVisible = false
        super.onStop()
    }

    override fun onDestroy() {
        isVisible = false
        checkHandler.removeCallbacks(autoCloseRunnable)
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        navigateHome()
    }

    private fun navigateHome() {
        try {
            val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(homeIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to navigate home on back press", e)
        }
        finish()
    }

    companion object {
        private const val TAG = "RhythmOverlay"

        @Volatile
        var isVisible: Boolean = false
    }
}
