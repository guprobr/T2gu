#include "LoadingOverlayWidget.h"

#include <QLabel>
#include <QVBoxLayout>

LoadingOverlayWidget::LoadingOverlayWidget(QWidget *parent)
    : QWidget(parent)
{
    // A plain QWidget doesn't paint its stylesheet's background-color on
    // itself by default - without this attribute the black background
    // wouldn't actually cover the view underneath.
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet(QStringLiteral("background-color: black;"));

    m_loadingLabel = new QLabel(QStringLiteral("Loading"), this);
    m_loadingLabel->setAlignment(Qt::AlignCenter);
    m_loadingLabel->setStyleSheet(
        QStringLiteral("color: #ffd700; font-weight: bold; font-size: 60px; border: none; background: transparent;"));

    m_chapterLabel = new QLabel(this);
    m_chapterLabel->setAlignment(Qt::AlignCenter);
    m_chapterLabel->setStyleSheet(
        QStringLiteral("color: #ffd700; font-size: 32px; border: none; background: transparent;"));

    auto *layout = new QVBoxLayout(this);
    layout->addStretch();
    layout->addWidget(m_loadingLabel);
    layout->addWidget(m_chapterLabel);
    layout->addStretch();

    hide();
}

void LoadingOverlayWidget::showLoading(const QString &chapterTitle)
{
    m_chapterLabel->setText(chapterTitle);
    m_chapterLabel->setVisible(!chapterTitle.isEmpty());
    show();
    raise();
}
