#include "FireballItem.h"

#include <QGraphicsScene>
#include <QPainter>
#include <QRadialGradient>
#include <algorithm>
#include <cmath>

namespace {
constexpr int kAnimIntervalMs = 16;
constexpr qreal kImpactDurationMs = 220.0;
constexpr qreal kBaseGlowRadius = 44.0;
constexpr qreal kGlowRadiusPerInt = 2.6;
constexpr int kBaseAlpha = 150;
constexpr int kAlphaPerInt = 9;
// Mirrors GameScene's own kFireballMinIntelligence - the intelligence at
// which a fireball is barely castable at all reads as its baseline
// brightness/size; every point above that scales both up further, the
// same reference point GameScene's damage/cooldown formulas use.
constexpr int kFireballReferenceIntelligence = 12;
}

FireballItem::FireballItem(QGraphicsScene *scene, QPointF start, QPointF end, qreal durationSeconds, int intelligence)
    : QObject(nullptr)
    , QGraphicsItem()
    , m_localEnd(end - start)
    , m_durationMs(std::max(1.0, durationSeconds * 1000.0))
    , m_impactDurationMs(kImpactDurationMs)
{
    const int overInt = std::max(0, intelligence - kFireballReferenceIntelligence);
    m_glowRadius = kBaseGlowRadius + overInt * kGlowRadiusPerInt;
    m_coreAlpha = std::clamp(kBaseAlpha + overInt * kAlphaPerInt, 0, 255);

    // Positioned in scene space, not parented to either character - a
    // fireball travels independently of whoever cast/is being hit by it,
    // so it needs its own top-level place in the scene rather than
    // inheriting a moving character's local transform.
    setPos(start);
    setZValue(900000.0); // above every world-Y-ordered Character/Prop, comfortably below LevelUpTextItem's 1,000,000
    scene->addItem(this);

    m_clock.start();
    connect(&m_timer, &QTimer::timeout, this, [this] {
        if (m_clock.elapsed() >= m_durationMs + m_impactDurationMs) {
            m_timer.stop();
            deleteLater(); // detaches from the scene along with it
            return;
        }
        update();
    });
    m_timer.start(kAnimIntervalMs);
}

QRectF FireballItem::boundingRect() const
{
    // Generous box covering the whole travel line plus the glow/impact
    // flash's radius at every point along it.
    const qreal r = m_glowRadius * 2.0;
    const qreal minX = std::min(0.0, m_localEnd.x()) - r;
    const qreal minY = std::min(0.0, m_localEnd.y()) - r;
    const qreal maxX = std::max(0.0, m_localEnd.x()) + r;
    const qreal maxY = std::max(0.0, m_localEnd.y()) + r;
    return QRectF(QPointF(minX, minY), QPointF(maxX, maxY));
}

void FireballItem::paint(QPainter *painter, const QStyleOptionGraphicsItem *, QWidget *)
{
    const qreal elapsed = m_clock.elapsed();
    painter->setPen(Qt::NoPen);

    if (elapsed < m_durationMs) {
        const qreal t = elapsed / m_durationMs;

        // A short fading trail behind the bolt's current position - a
        // handful of shrinking, fading circles standing in for a real
        // particle system, the same "cheap approximation, not per-pixel
        // work" spirit as Character/Prop's own ground-shadow gradients.
        constexpr int kTrailSteps = 4;
        for (int i = kTrailSteps; i >= 0; --i) {
            const qreal trailT = std::clamp(t - i * 0.05, 0.0, 1.0);
            const QPointF trailPos = m_localEnd * trailT;
            const qreal fade = 1.0 - qreal(i) / (kTrailSteps + 1);
            const qreal radius = m_glowRadius * (0.5 + 0.5 * fade);

            QRadialGradient gradient(trailPos, radius);
            gradient.setColorAt(0.0, QColor(255, 205, 160, int(m_coreAlpha * fade)));
            gradient.setColorAt(0.4, QColor(255, 80, 25, int(m_coreAlpha * 0.8 * fade)));
            gradient.setColorAt(1.0, QColor(220, 20, 10, 0));
            painter->setBrush(gradient);
            painter->drawEllipse(trailPos, radius, radius);
        }
    } else {
        // Impact: one quick expanding, fading flash at the target point.
        const qreal impactT = (elapsed - m_durationMs) / m_impactDurationMs;
        const qreal radius = m_glowRadius * (1.0 + impactT * 1.8);
        const int alpha = int(m_coreAlpha * (1.0 - impactT));

        QRadialGradient gradient(m_localEnd, radius);
        gradient.setColorAt(0.0, QColor(255, 205, 170, alpha));
        gradient.setColorAt(0.5, QColor(255, 70, 20, int(alpha * 0.7)));
        gradient.setColorAt(1.0, QColor(220, 20, 10, 0));
        painter->setBrush(gradient);
        painter->drawEllipse(m_localEnd, radius, radius);
    }
}
