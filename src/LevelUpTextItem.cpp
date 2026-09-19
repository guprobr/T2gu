#include "LevelUpTextItem.h"

#include <QFont>
#include <QPainter>
#include <algorithm>

namespace {
constexpr int kAnimIntervalMs = 30;
constexpr qreal kDurationMs = 1300.0;
// Doubled along with the 2x asset scale (see tools/upscale_2x.py) so the
// rise stays proportional to the now-bigger character sprite it floats
// above, rather than reading as a much smaller fraction of its height.
constexpr qreal kRiseDistancePx = 120.0;
// Where the caption starts, above the top of the character's head: just
// clear of the health bar (which spans 40-60px above the head, see
// Character::ensureHealthBar()) - the text is 40px tall and centered on
// its anchor, so this leaves a 5px gap. Any higher and, in a modest
// window, it starts at the very top edge of the view and rises off it.
constexpr qreal kGapAboveHeadPx = 85.0;
constexpr qreal kTextHalfHeightPx = 20.0;
}

LevelUpTextItem::LevelUpTextItem(QGraphicsItem *parent, qreal headTopY)
    : QObject(nullptr)
    , QGraphicsItem(parent)
{
    // Anchored at the horizontal center of the character's own sprite,
    // just above its head - "emerging from the top of the player." This
    // used to be y=0, the top of the sprite CELL, which stopped being near
    // the head once the art was refit with a large empty margin above the
    // character: the caption started hundreds of pixels above it, off the
    // top of the screen. paint() moves it further up from here over time
    // rather than this item's own pos() changing, so a single elapsed-time
    // read drives both the rise and the fade consistently.
    setPos(parent->boundingRect().center().x(), headTopY - kGapAboveHeadPx);
    setZValue(1'000'000.0); // always drawn on top, regardless of anything else going on

    m_clock.start();
    connect(&m_timer, &QTimer::timeout, this, [this] {
        if (m_clock.elapsed() >= kDurationMs) {
            m_timer.stop();
            deleteLater(); // detaches from the parent Character and the scene along with it
            return;
        }
        update();
    });
    m_timer.start(kAnimIntervalMs);
}

QRectF LevelUpTextItem::boundingRect() const
{
    // Must cover everything paint() draws: the text starts at y=0 and
    // rises kRiseDistancePx above that. This used to be a 50px-tall box at
    // the very top of the rise only, so for most of the animation the text
    // sat outside its own bounding rect - and Qt culls and invalidates an
    // item by that rect, not by what it actually paints.
    return QRectF(-90, -kRiseDistancePx - kTextHalfHeightPx, 180, kRiseDistancePx + 2 * kTextHalfHeightPx);
}

void LevelUpTextItem::paint(QPainter *painter, const QStyleOptionGraphicsItem *, QWidget *)
{
    const qreal t = std::min(1.0, m_clock.elapsed() / kDurationMs);
    const qreal yOffset = -kRiseDistancePx * t;
    const int alpha = int(255 * (1.0 - t));

    QFont font = painter->font();
    font.setBold(true);
    font.setPointSize(18);
    painter->setFont(font);
    painter->setPen(QColor(255, 215, 0, alpha)); // yellow/gold, same tone as the loading-screen text
    painter->drawText(QRectF(-90, yOffset - 20, 180, 40), Qt::AlignCenter, QStringLiteral("Level Up!"));
}
