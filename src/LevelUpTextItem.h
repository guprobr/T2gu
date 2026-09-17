#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QObject>
#include <QTimer>

// A transient "Level Up!" caption that rises up from the top of a
// character and fades out over a little over a second, then removes
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
    explicit LevelUpTextItem(QGraphicsItem *parent);

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QElapsedTimer m_clock;
    QTimer m_timer;
};
