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
constexpr qreal kRiseDistancePx = 140.0;
}

LevelUpTextItem::LevelUpTextItem(QGraphicsItem *parent)
    : QObject(nullptr)
    , QGraphicsItem(parent)
{
    // Anchored at the horizontal center of the character's own sprite,
    // right at its top edge (y=0 in the parent's local coordinates, since
    // Character's own boundingRect() starts at (0,0)) - "emerging from the
    // top of the player." paint() moves it further up from here over time
    // rather than this item's own pos() changing, so a single elapsed-time
    // read drives both the rise and the fade consistently.
    setPos(parent->boundingRect().center().x(), 0);
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
    // Generous box covering the full rise distance plus text width/height.
    return QRectF(-90, -kRiseDistancePx - 30, 180, 50);
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
