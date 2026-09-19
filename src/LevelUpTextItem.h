#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QObject>
#include <QTimer>

// A transient "Level Up!" caption that rises up from just above a
// character's head and fades out over a little over a second, then removes
// itself - see GameScene::showLevelUpEffect(). Constructed as a CHILD of
// the character it's celebrating (parent = that Character), so it tracks
// the character's position automatically via Qt's normal parent/child
// item transform, the same trick Character's own health bar rect items
// use for themselves.
class LevelUpTextItem : public QObject, public QGraphicsItem
{
    Q_OBJECT
    Q_INTERFACES(QGraphicsItem)

public:
    // headTopY is where the character's visible content starts, in the
    // parent's own coordinates (Character::headTopY()) - the caption
    // anchors a fixed distance above that, clear of the health bar.
    LevelUpTextItem(QGraphicsItem *parent, qreal headTopY);

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QElapsedTimer m_clock;
    QTimer m_timer;
};
