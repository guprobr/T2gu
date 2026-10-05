#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QObject>
#include <QTimer>

// A transient "Level Up!" caption that rises up from just above a
// character's head and fades out over a little over a second, then removes
// itself - see GameScene::showLevelUpEffect(). A scene-owned top-level item
// so its notification layer can sit above unrelated scenery and lighting.
// GameScene cancels it before deleting its anchor; the animation timer
// follows that anchor's head position while the caption rises and fades.
class LevelUpTextItem : public QObject, public QGraphicsItem
{
    Q_OBJECT
    Q_INTERFACES(QGraphicsItem)

public:
    // headTopY is where the character's visible content starts, in the
    // anchor's own coordinates (Character::headTopY()) - the caption
    // anchors a fixed distance above that, clear of the health bar.
    LevelUpTextItem(QGraphicsItem *anchor, qreal headTopY);
    QGraphicsItem *anchorItem() const { return m_anchor; }
    void updateAnchorPosition();

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QElapsedTimer m_clock;
    QTimer m_timer;
    QGraphicsItem *m_anchor;
    QPointF m_localAnchor;
};
