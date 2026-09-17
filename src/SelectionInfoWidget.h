#pragma once

#include <QWidget>

#include "GameScene.h"

class QLabel;

// A small, non-modal HUD panel shown while something is selected (see
// GameScene::mousePressEvent()'s click-to-select/click-again-or-click-
// empty-to-deselect handling) - portrait, name, and (for a character, not
// an item) HP and the party's shared level. Unlike InventoryWidget/
// DeathMenuWidget this never pauses movement or takes keyboard focus: it's
// meant to sit alongside ordinary play, not interrupt it.
class SelectionInfoWidget : public QWidget
{
    Q_OBJECT

public:
    explicit SelectionInfoWidget(QWidget *parent = nullptr);

    void showInfo(const GameScene::SelectionInfo &info);

private:
    QLabel *m_portraitLabel;
    QLabel *m_nameLabel;
    QLabel *m_descriptionLabel;
    QLabel *m_statsLabel;
};
