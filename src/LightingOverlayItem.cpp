#include "LightingOverlayItem.h"

#include <QLinearGradient>
#include <QPainter>
#include <QRadialGradient>
#include <cmath>

#include "VisibleSceneRect.h"

namespace {
// Slower than TileMapItem's water-ripple cadence - every mode here is a
// slow breathing/flicker/hue-drift, not a fast displacement illusion, so
// redrawing more often than this would just burn cycles nobody can see.
//
// This timer's own update() used to be a bare, argument-less call, which
// implicitly dirties the item's WHOLE boundingRect - the entire map, for
// this item - forcing Qt to reconsider every other visible item underneath
// it too, regardless of how much of the map was actually on screen.
// Measured to compound badly with several actively-moving/animating party
// members on screen (see GameScene::updatePartyAI()): a real soak test
// with 3 active companions showed frame cost climbing ~2.6x over a 150s
// session. Raising this interval (to 320ms at one point) masked the
// symptom but didn't address the actual bug - an update() this size
// doesn't get cheaper just because it happens less often, and it was only
// ever going to get worse on a bigger map. The real fix is
// visibleSceneRectFor() (see VisibleSceneRect.h, used in the constructor
// below): dirty only what's currently on screen, the same way paint()
// below already only draws what's relevant to the current mode. With that
// in place this can go back to its original interval. Doubled per request
// (purely decorative - the breathing/flicker/hue-drift reads just as well
// at half the update rate, and it's cheaper besides).
constexpr int kAnimIntervalMs = 240;
}

LightingOverlayItem::LightingOverlayItem(QString mode, qreal mapPixelWidth, qreal mapPixelHeight, QGraphicsItem *parent)
    : QObject(nullptr)
    , QGraphicsItem(parent)
    , m_mode(std::move(mode))
    , m_width(mapPixelWidth)
    , m_height(mapPixelHeight)
{
    setAcceptedMouseButtons(Qt::NoButton);
    m_clock.start();
}

void LightingOverlayItem::tick()
{
    const qint64 nowMs = m_clock.elapsed();
    if (nowMs - m_lastUpdateMs < kAnimIntervalMs)
        return;
    m_lastUpdateMs = nowMs;
    // Only the currently-visible portion, not the whole map - see
    // VisibleSceneRect.h for why a bare update() here is the wrong call on
    // an item this size.
    update(visibleSceneRectFor(this));
}

QRectF LightingOverlayItem::boundingRect() const
{
    return QRectF(0, 0, m_width, m_height);
}

void LightingOverlayItem::paint(QPainter *painter, const QStyleOptionGraphicsItem *, QWidget *)
{
    const qreal t = m_clock.elapsed() / 1000.0;
    const QRectF rect(0, 0, m_width, m_height);

    painter->save();
    painter->setPen(Qt::NoPen);

    if (m_mode == QLatin1String("sunrise") || m_mode == QLatin1String("sunset")) {
        const bool sunset = m_mode == QLatin1String("sunset");
        // A slow breathing glow, as if the light is gently strengthening
        // or fading rather than sitting at one fixed brightness - period
        // deliberately long (18s) so it reads as ambient drift, not a
        // pulse anyone would consciously notice ticking.
        const qreal breathe = 0.5 + 0.5 * std::sin(t * (2.0 * M_PI / 18.0));

        // Alphas roughly doubled from the first pass (2026-09-10 follow-up)
        // - the original values were tuned too conservatively and read as
        // "barely there" over a fully-lit, colorful tilemap+sprites scene.
        QLinearGradient sky(0, 0, 0, m_height);
        if (sunset) {
            sky.setColorAt(0.0, QColor(120, 60, 110, int(130 + 35 * breathe)));
            sky.setColorAt(0.5, QColor(200, 100, 90, int(65 + 18 * breathe)));
            sky.setColorAt(1.0, QColor(60, 50, 90, 0));
        } else {
            sky.setColorAt(0.0, QColor(255, 200, 150, int(100 + 28 * breathe)));
            sky.setColorAt(0.5, QColor(255, 225, 180, int(48 + 16 * breathe)));
            sky.setColorAt(1.0, QColor(255, 255, 240, 0));
        }
        painter->fillRect(rect, sky);

        // A soft sun glow anchored at one top corner - there's no single
        // fixed "east"/"west" tile this engine's maps agree on (the
        // horizon border art cycles the same way on every edge), so the
        // corner itself is the anchor: sunrise glows from the top-right,
        // sunset from the top-left, which is enough to read as directional
        // light without pretending to track a real sun position.
        QRadialGradient sun(sunset ? QPointF(0, 0) : QPointF(m_width, 0), m_width * 0.68);
        const QColor sunColor = sunset ? QColor(255, 140, 90) : QColor(255, 235, 180);
        sun.setColorAt(0.0, QColor(sunColor.red(), sunColor.green(), sunColor.blue(), int(150 + 40 * breathe)));
        sun.setColorAt(1.0, QColor(sunColor.red(), sunColor.green(), sunColor.blue(), 0));
        painter->fillRect(rect, sun);
    } else if (m_mode == QLatin1String("torch")) {
        // Flame flicker: two sine waves at close-but-different frequencies,
        // summed - avoids the too-regular "breathing" look a single sine
        // gives and reads instead as an unsteady flame, while staying
        // fully deterministic frame to frame (same idea as the water
        // ripple's time-based phase - no actual randomness to seed/track).
        const qreal flicker = 0.5 + 0.3 * std::sin(t * 6.3) + 0.2 * std::sin(t * 9.7 + 1.3);
        const int alpha = int(55 + 38 * flicker);
        painter->fillRect(rect, QColor(255, 150, 60, alpha));
    } else if (m_mode == QLatin1String("cavern")) {
        // A cool, dim vignette - lighter/neutral in the middle (where a
        // torch or glow-crystal prop would plausibly be standing), darker
        // and bluer toward the corners, with a very slow breathing
        // glimmer (like distant water catching what little light there
        // is) rather than a flat, static darken.
        const qreal glimmer = 0.5 + 0.5 * std::sin(t * (2.0 * M_PI / 7.0));
        QRadialGradient vignette(rect.center(), std::hypot(m_width, m_height) * 0.55);
        vignette.setColorAt(0.0, QColor(40, 60, 70, int(25 + 18 * glimmer)));
        vignette.setColorAt(1.0, QColor(5, 10, 25, 175));
        painter->fillRect(rect, vignette);
    } else if (m_mode == QLatin1String("mystical")) {
        // A slow hue rotation (full cycle every 24s) rather than a fixed
        // color - reads as living arcane energy instead of a static tint.
        const qreal hue = std::fmod(t / 24.0, 1.0);
        QColor glow;
        glow.setHsvF(hue, 0.7, 1.0);
        const qreal pulse = 0.5 + 0.5 * std::sin(t * (2.0 * M_PI / 5.0));
        QRadialGradient aura(rect.center(), std::hypot(m_width, m_height) * 0.55);
        aura.setColorAt(0.0, QColor(glow.red(), glow.green(), glow.blue(), int(65 + 35 * pulse)));
        aura.setColorAt(1.0, QColor(glow.red(), glow.green(), glow.blue(), 0));
        painter->fillRect(rect, aura);
    }

    painter->restore();
}
