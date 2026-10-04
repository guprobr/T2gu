#include "AudioManager.h"
#include "AssetPath.h"

#include <QUrl>
#include <utility>

AudioManager::AudioManager(QObject *parent)
    : QObject(parent)
{
    m_musicPlayer.setAudioOutput(&m_musicOutput);
    connect(&m_musicPlayer, &QMediaPlayer::mediaStatusChanged, this, [this](QMediaPlayer::MediaStatus status) {
        if (m_musicActive && status == QMediaPlayer::EndOfMedia
                && m_musicPlayer.mediaStatus() == status && m_musicPlayer.loops() != QMediaPlayer::Infinite) {
            m_musicActive = false;
            cancelMusicFade();
            m_musicOutput.setVolume(1.0f);
            emit musicFinished();
        }
    });
    connect(&m_musicPlayer, &QMediaPlayer::errorOccurred, this, [this](QMediaPlayer::Error error) {
        if (error == QMediaPlayer::NoError || m_musicPlayer.error() != error)
            return;
        // A failed request is not a completed track. Cancel its fade so
        // the intro deadline cannot later turn the failure into completion.
        m_musicActive = false;
        cancelMusicFade();
        m_musicOutput.setVolume(1.0f);
    });
}

QSoundEffect *AudioManager::effectFor(const QString &name)
{
    QSoundEffect *&effect = m_effects[name];
    if (!effect) {
        effect = new QSoundEffect(this);
        // .wav only - confirmed by testing, not assumption: QSoundEffect on
        // this Qt Multimedia setup fails to decode .ogg at all ("Error
        // decoding source"), even though QMediaPlayer (background music)
        // handles the exact same Vorbis-in-Ogg format fine. A new sfx MUST
        // ship as .wav; convert with `ffmpeg -i in.ogg -c:a pcm_s16le
        // out.wav` if it arrives as anything else.
        effect->setSource(QUrl::fromLocalFile(assetPath(QStringLiteral("/audio/sfx/%1.wav")).arg(name)));
    }
    return effect;
}

void AudioManager::playSound(const QString &name, qreal volume)
{
    QSoundEffect *effect = effectFor(name);

    // Re-triggering play() on a QSoundEffect that's already playing doesn't
    // just restart it - on this Qt6/PipeWire setup (confirmed by testing,
    // not assumed) it layers another concurrent stream underneath, each
    // with its own PipeWire loop/eventfd resources that don't get reclaimed
    // as fast as they can pile up. Harmless with a handful of characters
    // sharing a sound, but with a whistle/roar catalog this sparse (most of
    // the roster shares one of a couple of "soldier"/"undead" clips) and
    // maze populations now in the dozens, many creatures hitting the same
    // cached effect within the same second is common, not rare - enough of
    // them stacking up was reliably reproducing "eventfd failed: Too many
    // open files" during testing. Skipping a re-trigger while already
    // playing also just sounds better - a wall of identical overlapping
    // clips reads as noise, not as "several things happened."
    if (effect->isPlaying())
        return;

    effect->setVolume(qBound(0.0, volume, 1.0));
    effect->play();

    if (volume > 1.0) {
        // No headroom left on the primary cached voice (just clamped to
        // 1.0 above) - layer a second, temporary instance of the same clip
        // so a moment like the death bell genuinely reads louder instead
        // of silently doing nothing past the ceiling.
        auto *extra = new QSoundEffect(this);
        extra->setSource(effect->source());
        extra->setVolume(1.0);
        connect(extra, &QSoundEffect::playingChanged, extra, [extra]() {
            if (!extra->isPlaying())
                extra->deleteLater();
        });
        extra->play();
    }
}

void AudioManager::playMusic(const QString &name, bool loop)
{
    // A fade from a previous track still winding down would otherwise
    // finish later on top of this new one - silence it well before that,
    // and skip the volume/stop/musicFinished tail it would have run (this
    // fresh play() already supersedes all of that).
    m_musicActive = false;
    cancelMusicFade();
    m_musicOutput.setVolume(1.0f);

    m_musicPlayer.setSource(QUrl::fromLocalFile(assetPath(QStringLiteral("/audio/music/%1.ogg")).arg(name)));
    m_musicPlayer.setLoops(loop ? QMediaPlayer::Infinite : 1);
    m_musicActive = true;
    m_musicPlayer.play();
    if (m_musicPlayer.mediaStatus() == QMediaPlayer::InvalidMedia)
        m_musicActive = false;
}

void AudioManager::cancelMusicFade()
{
    if (!m_fadeAnimation)
        return;
    auto *fade = std::exchange(m_fadeAnimation, nullptr);
    // Disconnect before stopping: a stale completion must not stop a
    // replacement track or request automatic playback.
    disconnect(fade, nullptr, this, nullptr);
    fade->stop();
    fade->deleteLater();
}

void AudioManager::stopMusic()
{
    m_musicActive = false;
    cancelMusicFade();
    m_musicPlayer.stop();
    m_musicOutput.setVolume(1.0f);
}

void AudioManager::fadeOutMusic(int durationMs)
{
    cancelMusicFade();
    if (!m_musicActive)
        return;

    auto *fade = new QPropertyAnimation(&m_musicOutput, "volume", this);
    fade->setDuration(qMax(0, durationMs));
    fade->setStartValue(m_musicOutput.volume());
    fade->setEndValue(0.0f);
    connect(fade, &QPropertyAnimation::finished, this, [this, fade]() {
        if (m_fadeAnimation != fade || !m_musicActive)
            return;
        m_fadeAnimation = nullptr;
        fade->deleteLater();
        stopMusic();
        emit musicFinished();
    });
    m_fadeAnimation = fade;
    fade->start();
}
