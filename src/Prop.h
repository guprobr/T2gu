#pragma once

#include <QGraphicsPixmapItem>
#include <QPointF>
#include <QRectF>
#include <QSizeF>
#include <QString>

class QPainter;
class QStyleOptionGraphicsItem;

// A static (non-animated) environment object - a tree, a building, a piece
// of furniture - loaded from a single standalone PNG (not a sprite sheet,
// not a tile) and displayed at a calibrated target size, since the source
// art is generated at whatever resolution the model felt like and needs a
// deliberate size relative to everything else on the map.
//
// Positioned like Character: setPos() places the item's top-left corner,
// but callers almost always want to align the prop's ground-contact point
// (bottom-center, where it visually touches the floor) to a world
// location instead - see groundAnchorOffset().
class Prop : public QGraphicsPixmapItem
{
public:
    // targetWidth <= 0 keeps the source image's native pixel width - only
    // useful for already-correctly-sized art, real props should specify one.
    explicit Prop(const QString &imagePath, qreal targetWidth = 0, QGraphicsItem *parent = nullptr);

    // Always the full scaled art rect, not the (smaller) trimmed pixmap
    // actually drawn - see the trimming note in Prop.cpp. Everything that
    // lays out against a prop (groundAnchorOffset(), footprintRect(), the
    // shadow, the rotated border strips' transform origin, edge placement)
    // reads this.
    QRectF boundingRect() const override;

    QPointF groundAnchorOffset() const;

    // A deliberately small collision rect near the ground-contact point,
    // in item-local coordinates - not the full sprite silhouette, so a
    // character can walk near/behind a tall tree's canopy or a building's
    // roof overhang and only actually collide with its solid base. Callers
    // that need this in scene coordinates should map it themselves (e.g.
    // via mapToScene(...).boundingRect()) once the prop's final position
    // is set.
    QRectF footprintRect() const;

    // The props.json catalog key this instance was spawned from - set once
    // by GameScene::spawnPropAt() right after construction, mirroring how
    // Character::setName() works. Lets GameScene::interactWithNearby() look
    // the prop back up in the catalog for its examine name/description
    // without having to track that mapping separately.
    void setName(const QString &name) { m_name = name; }
    const QString &name() const { return m_name; }

    // Which way this prop's soft ground shadow (see paint()) leans, in
    // item-local pixels from groundAnchorOffset() - same convention and
    // same setter-caller (GameScene, from the map's ambient lighting mode)
    // as Character::setShadowOffset().
    void setShadowOffset(QPointF offset) { m_shadowOffset = offset; }

    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QString m_name;
    QPointF m_shadowOffset = QPointF(0, 18);
    QSizeF m_fullSize; // the full scaled art size boundingRect() reports

    // Real ground-contact point of this prop's own art, as a fraction of its
    // pixmap height - see the measurement helper in Prop.cpp for why this
    // can't be one fixed guess shared by every prop the way Character's
    // feetFraction() is for the (uniformly-piped) character roster.
    qreal m_feetFraction = 0.95;
};
