#include "DialogueBoxWidget.h"

#include <QLabel>
#include <QVBoxLayout>

DialogueBoxWidget::DialogueBoxWidget(QWidget *parent)
    : QWidget(parent)
{
    // A plain QWidget doesn't paint its stylesheet's background-color/border
    // on itself by default (unlike QFrame) - without this attribute the
    // panel is invisible and only its child labels' text shows up.
    setAttribute(Qt::WA_StyledBackground, true);
    setStyleSheet(QStringLiteral(
        "background-color: rgba(10, 10, 20, 225); border: 2px solid #d4af37; border-radius: 6px;"));

    m_speakerLabel = new QLabel(this);
    m_speakerLabel->setStyleSheet(
        QStringLiteral("color: #d4af37; font-weight: bold; font-size: 28px; border: none; background: transparent;"));

    m_textLabel = new QLabel(this);
    m_textLabel->setWordWrap(true);
    m_textLabel->setStyleSheet(QStringLiteral("color: white; font-size: 26px; border: none; background: transparent;"));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(16, 10, 16, 12);
    layout->addWidget(m_speakerLabel);
    layout->addWidget(m_textLabel);
    layout->addStretch();

    hide();
}

void DialogueBoxWidget::showMessage(const QString &speaker, const QString &text)
{
    m_speakerLabel->setText(speaker);
    m_textLabel->setText(text);
    show();
    raise();
}
