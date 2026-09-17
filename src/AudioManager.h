#pragma once

#include <QAudioOutput>
#include <QHash>
#include <QMediaPlayer>
#include <QObject>
#include <QPropertyAnimation>
#include <QSoundEffect>
#include <QString>

// Short one-shot SFX (assets/audio/sfx/<name>.wav - MUST be .wav, see
// effectFor()) via QSoundEffect - low latency, fine with several overlapping
// at once, but only really meant for short clips. Background music
// (assets/audio/music/<name>.ogg) is a separate concern via
// QMediaPlayer/QAudioOutput, since QSoundEffect isn't meant for long
// streams (and, confirmed by testing, can't even decode .ogg on this setup
// the way QMediaPlayer can). Effects are loaded once and cached by name -
// the same handful of sounds (attack, hit, death, select) play constantly
// during combat, so reloading from disk every time would be wasteful.
class AudioManager : public QObject
{
    Q_OBJECT

public:
    explicit AudioManager(QObject *parent = nullptr);

    // `volume` is a linear gain, normally in [0.0, 1.0] like QSoundEffect's
    // own setVolume() - every existing caller already plays at the implicit
    // default (1.0), so there's no headroom to actually exceed that on a
    // single voice. A value above 1.0 (e.g. 2.0 for the death bell) instead
    // triggers a second overlapping instance of the same clip at full
    // volume, approximating a real loudness bump through layering rather
    // than silently clamping and doing nothing.
    void playSound(const QString &name, qreal volume = 1.0);
    void playMusic(const QString &name, bool loop = true);
    void stopMusic();
    // Ramps the current track's volume down to silent over durationMs, then
    // stops it and restores full volume (so whatever plays next via
    // playMusic() isn't left silently inheriting 0) and emits
    // musicFinished() - the same "this track is done" signal a track
    // reaching its own natural end fires, so a caller reacting to either
    // doesn't need two separate handlers. See GameScene's ambient intro,
    // faded out partway through rather than left to play its full length.
    void fadeOutMusic(int durationMs);

signals:
    // Fires when a track started with loop=false actually reaches its end
    // - never for a looping track (guarded on the player's own configured
    // loop count, not just "did EndOfMedia happen to fire," since some
    // backends report EndOfMedia between iterations of an infinite loop
    // too; a caller reacting to "the intro finished" by starting new music
    // must not have that misfire every time a *looping* level track wraps
    // around). See GameScene's ambient-then-level-music handoff for the
    // one current use.
    void musicFinished();

private:
    QSoundEffect *effectFor(const QString &name);

    QHash<QString, QSoundEffect *> m_effects;
    QMediaPlayer m_musicPlayer;
    QAudioOutput m_musicOutput;
    // Owned by `this` (QObject parent), but tracked here too so a second
    // fadeOutMusic()/playMusic() call while one is still running can stop
    // and discard the stale one instead of leaving it to finish later and
    // clobber whatever's playing by then.
    QPropertyAnimation *m_fadeAnimation = nullptr;
};
