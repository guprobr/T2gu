#include "SelectionInfoWidget.h"

#include <QHBoxLayout>
#include <QLabel>
#include <QVBoxLayout>

SelectionInfoWidget::SelectionInfoWidget(QWidget *parent)
    : QWidget(parent)
{
    // Same "plain QWidget needs this to paint its own stylesheet" gotcha
    // DialogueBoxWidget/InventoryWidget already document.
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet(QStringLiteral(
            "background-color: rgba(10, 10, 20, 215); border: 2px solid #d4af37; border-radius: 6px;"));
    setFocusPolicy(Qt::NoFocus); // never takes keyboard focus - MainWindow still handles every key

    m_portraitLabel = new QLabel(this);
    m_portraitLabel->setFixedSize(64, 64);
    m_portraitLabel->setAlignment(Qt::AlignCenter);
    m_portraitLabel->setStyleSheet(QStringLiteral("border: none; background: transparent;"));

    m_nameLabel = new QLabel(this);
    m_nameLabel->setStyleSheet(
            QStringLiteral("color: #d4af37; font-weight: bold; font-size: 14px; border: none; background: transparent;"));

    m_descriptionLabel = new QLabel(this);
    m_descriptionLabel->setWordWrap(true);
    m_descriptionLabel->setAlignment(Qt::AlignTop | Qt::AlignLeft);
    m_descriptionLabel->setStyleSheet(QStringLiteral("color: white; font-size: 12px; border: none; background: transparent;"));

    m_statsLabel = new QLabel(this);
    m_statsLabel->setStyleSheet(QStringLiteral("color: #9fd3ff; font-size: 12px; border: none; background: transparent;"));

    auto *textLayout = new QVBoxLayout;
    textLayout->addWidget(m_nameLabel);
    textLayout->addWidget(m_descriptionLabel, 1);
    textLayout->addWidget(m_statsLabel);

    auto *layout = new QHBoxLayout(this);
    layout->setContentsMargins(12, 10, 12, 10);
    layout->addWidget(m_portraitLabel);
    layout->addLayout(textLayout, 1);

    hide();
}

void SelectionInfoWidget::showInfo(const GameScene::SelectionInfo &info)
{
    m_portraitLabel->setPixmap(info.portrait.scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    m_nameLabel->setText(info.name);
    m_descriptionLabel->setText(info.description);
    m_descriptionLabel->setVisible(!info.description.isEmpty());

    QStringList stats;
    if (info.hasHp)
        stats << QStringLiteral("HP: %1/%2").arg(info.hp).arg(info.maxHp);
    if (info.hasLevel)
        stats << QStringLiteral("Level: %1").arg(info.level);
    m_statsLabel->setText(stats.join(QStringLiteral("   ")));
    m_statsLabel->setVisible(!stats.isEmpty());

    show();
}
