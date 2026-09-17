#pragma once

#include <QVector>
#include <QWidget>

#include "GameScene.h"

class QListWidget;
class QLabel;

// The inventory menu overlay - browse held items (icon + name + count), see
// a description, select one for MainWindow to activate via
// GameScene::useItem(). Holds no game logic, same division of
// responsibility as DialogueBoxWidget: MainWindow owns opening/closing it
// and drives all key handling - this widget stays Qt::NoFocus, consistent
// with every other widget here ("keys are handled on the window", per
// MainWindow's own setFocusPolicy comment).
class InventoryWidget : public QWidget
{
    Q_OBJECT

public:
    explicit InventoryWidget(QWidget *parent = nullptr);

    // Repopulates the list from a fresh snapshot (see
    // GameScene::inventoryEntries()) and selects the first row, or shows an
    // "empty" placeholder if nothing is held. Call again after using an
    // item, since a consumed item's count (or the whole row) may change.
    void refresh(const QVector<GameScene::ItemEntry> &items);
    // Moves the current selection by delta (wraps around). No-op if empty.
    void moveSelection(int delta);
    // The currently selected row's item id, or an empty string if nothing
    // is selected (an empty inventory).
    QString selectedItemId() const;

private:
    void updateDescriptionForCurrentRow();

    QListWidget *m_list;
    QLabel *m_nameLabel;
    QLabel *m_descriptionLabel;
    QLabel *m_hintLabel;
};
