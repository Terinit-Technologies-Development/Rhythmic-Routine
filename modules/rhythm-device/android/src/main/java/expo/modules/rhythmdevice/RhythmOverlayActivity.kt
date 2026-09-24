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
    private var interventionMode: String = "ROUTINE"
    private var attentionTitle: TextView? = null
    private var attentionSubtitle: TextView? = null
    private var continueReadingButton: Button? = null
    private var attentionRefreshDone = false

    private val autoCloseRunnable = object : Runnable {
        override fun run() {
            val pkg = targetPackage
            if (pkg != null) {
                val now = System.currentTimeMillis()
                if (interventionMode == "COOLDOWN" && cooldownEndsAt > 0L && now >= cooldownEndsAt && !attentionRefreshDone) {
                    attentionRefreshDone = true
                    refreshProductiveAttentionContent(pkg, now)
                }
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
        interventionMode = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_INTERVENTION_MODE) ?: "ROUTINE"
        val groupName = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_GROUP_NAME) ?: "This Risk Group"
        val activityEmoji = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_EMOJI) ?: "🌱"
        val activityTitle = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_TITLE)
        val activitySubtitle = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_SUBTITLE)
        val activityDuration = intent?.getStringExtra(RhythmNativePolicyKeys.EXTRA_ACTIVITY_DURATION)
        val ordinal = intent?.getIntExtra(RhythmNativePolicyKeys.EXTRA_ATTENTION_ORDINAL, 0) ?: 0
        val requiredSeconds = intent?.getLongExtra(RhythmNativePolicyKeys.EXTRA_REQUIRED_READING_SECONDS, 0L) ?: 0L
        val requiredPages = intent?.getIntExtra(RhythmNativePolicyKeys.EXTRA_REQUIRED_QUALIFIED_PAGES, 0) ?: 0
        val remainingSeconds = intent?.getLongExtra(RhythmNativePolicyKeys.EXTRA_REMAINING_READING_SECONDS, requiredSeconds) ?: requiredSeconds
        val remainingPages = intent?.getIntExtra(RhythmNativePolicyKeys.EXTRA_REMAINING_QUALIFIED_PAGES, requiredPages) ?: requiredPages
        val readerAvailable = intent?.getBooleanExtra(RhythmNativePolicyKeys.EXTRA_READER_PROVIDER_AVAILABLE, false) ?: false
        val readerCompatible = intent?.getBooleanExtra(RhythmNativePolicyKeys.EXTRA_READER_PROTOCOL_COMPATIBLE, false) ?: false
        val readerAppAvailable = intent?.getBooleanExtra(RhythmNativePolicyKeys.EXTRA_READER_APP_AVAILABLE, false) ?: false

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
            text = if (interventionMode == "PRODUCTIVE_ATTENTION") "Productive attention" else "Touch Grass"
            textSize = 28f
            setTextColor(Color.parseColor("#164B38"))
            gravity = Gravity.CENTER
            paint.isFakeBoldText = true
            setPadding(0, 0, 0, 16)
        }
        attentionTitle = titleView

        val subtitleView = TextView(this).apply {
            text = when (interventionMode) {
                "PRODUCTIVE_ATTENTION" -> productiveAttentionMessage(
                    groupName, ordinal, requiredSeconds, requiredPages,
                    remainingSeconds, remainingPages, readerAvailable, readerCompatible,
                )
                "COOLDOWN" -> {
                    val duration = activityDuration?.let { " · $it" } ?: ""
                    val nextStep = if (requiredSeconds > 0L || requiredPages > 0) {
                        "\n\nAfter the timer, complete Productive attention in Rhythmic Reader."
                    } else ""
                    if (activityTitle != null) {
                        "$groupName has reached its shared allowance.\n\nTry this while the cooldown runs:\n$activityEmoji $activityTitle\n${activitySubtitle ?: "Take a mindful offline break."}$duration$nextStep"
                    } else {
                        "$groupName is in a recovery cooldown.\n\nReturn home while the timer runs.$nextStep"
                    }
                }
                else -> if (activityTitle != null) {
                val duration = activityDuration?.let { " · $it" } ?: ""
                "$groupName has reached its shared allowance.\n\nTry this while your group resets:\n$activityEmoji $activityTitle\n${activitySubtitle ?: "Take a mindful offline break."}$duration"
                } else {
                    "This app is paused by your current Rhythm window.\n\nReturn home for now, or open Rhythm to review your routine."
                }
            }
            textSize = 15f
            setTextColor(Color.parseColor("#5A6B5C"))
            gravity = Gravity.CENTER
            setLineSpacing(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 4f, resources.displayMetrics), 1f)
            setPadding(0, 0, 0, 48)
        }
        attentionSubtitle = subtitleView

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

        val continueReadingBtn = Button(this).apply {
            text = "Continue Reading"
            visibility = if (interventionMode == "PRODUCTIVE_ATTENTION" && readerAppAvailable) android.view.View.VISIBLE else android.view.View.GONE
            setTextColor(Color.WHITE)
            textSize = 16f
            val bg = GradientDrawable().apply {
                setColor(Color.parseColor("#47775C"))
                cornerRadius = 999f
            }
            background = bg
            setPadding(48, 28, 48, 28)
            setOnClickListener { launchReaderNormally() }
        }
        continueReadingButton = continueReadingBtn

        rootLayout.addView(emojiView)
        rootLayout.addView(titleView)
        rootLayout.addView(subtitleView)
        rootLayout.addView(continueReadingBtn)
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

    private fun productiveAttentionMessage(
        groupName: String,
        ordinal: Int,
        requiredSeconds: Long,
        requiredPages: Int,
        remainingSeconds: Long,
        remainingPages: Int,
        readerAvailable: Boolean,
        readerCompatible: Boolean,
    ): String {
        val ordinalLabel = if (ordinal > 0) " (cooldown #$ordinal today)" else ""
        val requirement = buildString {
            if (remainingSeconds > 0L) append("${formatReadingTime(remainingSeconds)} of verified reading time")
            if (remainingSeconds > 0L && remainingPages > 0) append(" and ")
            if (remainingPages > 0) append("$remainingPages qualified pages")
            if (remainingSeconds <= 0L && remainingPages <= 0) append("your reading progress")
        }
        return when {
            !readerAvailable -> "$groupName cooldown is complete$ordinalLabel. Productive attention remains required: $requirement.\n\nReader evidence is unavailable, so progress cannot be verified yet."
            !readerCompatible -> "$groupName cooldown is complete$ordinalLabel. Productive attention remains required: $requirement.\n\nReader data is incompatible with the required evidence protocol."
            else -> "$groupName cooldown is complete$ordinalLabel.\n\nProductive attention required: $requirement. Reader verifies both reading time and qualified pages."
        }
    }

    private fun refreshProductiveAttentionContent(packageName: String, now: Long) {
        val info = RhythmEnforcementService.instance?.refreshAttentionForOverlay(packageName, now) ?: return
        if (info.mode != "PRODUCTIVE_ATTENTION") return
        interventionMode = info.mode
        cooldownEndsAt = info.cooldownEndsAt
        attentionTitle?.text = "Productive attention"
        val evaluation = info.evaluation
        attentionSubtitle?.text = productiveAttentionMessage(
            info.groupName,
            info.ordinal ?: 0,
            info.requiredReadingSeconds,
            info.requiredQualifiedPages,
            evaluation?.remainingSeconds ?: info.requiredReadingSeconds,
            evaluation?.remainingPages ?: info.requiredQualifiedPages,
            evaluation?.readerProviderAvailable ?: false,
            evaluation?.readerProtocolCompatible ?: false,
        )
        val readerInstalled = packageManager.getLaunchIntentForPackage("com.terinit.rhythmicreader") != null
        continueReadingButton?.visibility = if (readerInstalled) android.view.View.VISIBLE else android.view.View.GONE
    }

    private fun launchReaderNormally() {
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage("com.terinit.rhythmicreader")
            if (launchIntent == null) {
                continueReadingButton?.isEnabled = false
                continueReadingButton?.text = "Reader unavailable"
                return
            }
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(launchIntent)
            finish()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open Rhythmic Reader", error)
        }
    }

    private fun formatReadingTime(seconds: Long): String {
        val hours = seconds / 3600L
        val minutes = ((seconds % 3600L) + 59L) / 60L
        return if (hours > 0L) "${hours}h ${minutes}m" else "${minutes}m"
    }

    companion object {
        private const val TAG = "RhythmOverlay"

        @Volatile
        var isVisible: Boolean = false
    }
}
