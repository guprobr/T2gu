#include "DeathMenuWidget.h"

#include <QLabel>
#include <QListWidget>
#include <QVBoxLayout>

DeathMenuWidget::DeathMenuWidget(QWidget *parent)
    : QWidget(parent)
{
    // Same "plain QWidget needs this to paint its own stylesheet" gotcha
    // DialogueBoxWidget/InventoryWidget already document. A darker, more
    // severe border than the other two overlays (deep red instead of gold)
    // since this is a genuine "you died" moment, not routine UI.
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet(QStringLiteral(
            "background-color: rgba(15, 5, 5, 240); border: 2px solid #8b1a1a; border-radius: 6px;"));

    auto *titleLabel = new QLabel(QStringLiteral("You Died"), this);
    titleLabel->setAlignment(Qt::AlignHCenter);
    titleLabel->setStyleSheet(
            QStringLiteral("color: #d94848; font-weight: bold; font-size: 20px; border: none; background: transparent;"));

    m_list = new QListWidget(this);
    m_list->setFocusPolicy(Qt::NoFocus); // MainWindow drives selection, not the list itself
    m_list->addItem(QStringLiteral("Respawn from the Beginning"));
    m_list->addItem(QStringLiteral("Quit Game"));
    m_list->setStyleSheet(
            QStringLiteral("QListWidget { background: transparent; border: none; color: white; font-size: 14px; }"
                            "QListWidget::item { padding: 8px; text-align: center; }"
                            "QListWidget::item:selected { background-color: rgba(139, 26, 26, 120); border-radius: 3px; }"));

    auto *hintLabel = new QLabel(QStringLiteral("Up/Down: select   Enter: confirm"), this);
    hintLabel->setAlignment(Qt::AlignHCenter);
    hintLabel->setStyleSheet(QStringLiteral("color: #999999; font-size: 11px; border: none; background: transparent;"));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(20, 18, 20, 16);
    layout->addWidget(titleLabel);
    layout->addWidget(m_list, 1);
    layout->addWidget(hintLabel);

    reset();
    hide();
}

void DeathMenuWidget::reset()
{
    m_list->setCurrentRow(0);
}

void DeathMenuWidget::moveSelection(int delta)
{
    const int count = m_list->count();
    if (count == 0)
        return;
    const int row = ((m_list->currentRow() + delta) % count + count) % count;
    m_list->setCurrentRow(row);
}

DeathMenuWidget::Action DeathMenuWidget::selectedAction() const
{
    return m_list->currentRow() == 1 ? Action::Quit : Action::RespawnFromBeginning;
}
