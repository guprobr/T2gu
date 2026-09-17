#include "InventoryWidget.h"

#include <QHBoxLayout>
#include <QLabel>
#include <QListWidget>
#include <QPixmap>
#include <QVBoxLayout>

InventoryWidget::InventoryWidget(QWidget *parent)
    : QWidget(parent)
{
    // Same "plain QWidget needs this to paint its own stylesheet" gotcha
    // DialogueBoxWidget already documents.
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet(QStringLiteral(
            "background-color: rgba(10, 10, 20, 235); border: 2px solid #d4af37; border-radius: 6px;"));

    m_list = new QListWidget(this);
    m_list->setFocusPolicy(Qt::NoFocus); // MainWindow drives selection, not the list itself
    m_list->setIconSize(QSize(40, 40));
    m_list->setStyleSheet(QStringLiteral("QListWidget { background: transparent; border: none; color: white; "
                                          "font-size: 13px; }"
                                          "QListWidget::item { padding: 4px; }"
                                          "QListWidget::item:selected { background-color: rgba(212, 175, 55, 90); "
                                          "border-radius: 3px; }"));

    m_nameLabel = new QLabel(this);
    m_nameLabel->setStyleSheet(
            QStringLiteral("color: #d4af37; font-weight: bold; font-size: 15px; border: none; background: transparent;"));

    m_descriptionLabel = new QLabel(this);
    m_descriptionLabel->setWordWrap(true);
    m_descriptionLabel->setAlignment(Qt::AlignTop | Qt::AlignLeft);
    m_descriptionLabel->setStyleSheet(QStringLiteral("color: white; font-size: 13px; border: none; background: transparent;"));

    m_hintLabel = new QLabel(QStringLiteral("Up/Down: select   Enter: use   I / Esc: close"), this);
    m_hintLabel->setStyleSheet(QStringLiteral("color: #999999; font-size: 11px; border: none; background: transparent;"));

    auto *detailsLayout = new QVBoxLayout;
    detailsLayout->addWidget(m_nameLabel);
    detailsLayout->addWidget(m_descriptionLabel, 1);
    detailsLayout->addWidget(m_hintLabel);

    auto *layout = new QHBoxLayout(this);
    layout->setContentsMargins(16, 14, 16, 14);
    layout->addWidget(m_list, 1);
    layout->addLayout(detailsLayout, 1);

    hide();
}

void InventoryWidget::refresh(const QVector<GameScene::ItemEntry> &items)
{
    m_list->clear();

    if (items.isEmpty()) {
        m_nameLabel->setText(QStringLiteral("Inventory"));
        m_descriptionLabel->setText(QStringLiteral("Nothing held yet."));
        return;
    }

    for (const GameScene::ItemEntry &item : items) {
        auto *row = new QListWidgetItem(QIcon(QPixmap(item.imagePath)),
                                         QStringLiteral("%1 x%2").arg(item.name).arg(item.count));
        row->setData(Qt::UserRole, item.id);
        row->setData(Qt::UserRole + 1, item.description);
        m_list->addItem(row);
    }
    m_list->setCurrentRow(0);
    updateDescriptionForCurrentRow();
}

void InventoryWidget::moveSelection(int delta)
{
    const int count = m_list->count();
    if (count == 0)
        return;
    const int row = ((m_list->currentRow() + delta) % count + count) % count;
    m_list->setCurrentRow(row);
    updateDescriptionForCurrentRow();
}

QString InventoryWidget::selectedItemId() const
{
    QListWidgetItem *item = m_list->currentItem();
    return item ? item->data(Qt::UserRole).toString() : QString();
}

void InventoryWidget::updateDescriptionForCurrentRow()
{
    QListWidgetItem *item = m_list->currentItem();
    if (!item) {
        m_nameLabel->clear();
        m_descriptionLabel->clear();
        return;
    }
    m_nameLabel->setText(item->text());
    m_descriptionLabel->setText(item->data(Qt::UserRole + 1).toString());
}
