#pragma once

#include <QWidget>

class QListWidget;
class QLabel;

// The "You Died" modal - exactly 2 fixed rows (respawn from the beginning,
// or quit), so unlike InventoryWidget there's no dynamic refresh() needed.
// Same division of responsibility as every other overlay here: MainWindow
// owns showing/hiding it and drives all key handling (this widget stays
// Qt::NoFocus - "keys are handled on the window", per MainWindow's own
// setFocusPolicy comment).
class DeathMenuWidget : public QWidget
{
    Q_OBJECT

public:
    enum class Action { RespawnFromBeginning, Quit };

    explicit DeathMenuWidget(QWidget *parent = nullptr);

    // Resets the selection to the first row - call before showing, so it
    // doesn't remember whatever was selected the last time someone died.
    void reset();
    // Moves the current selection by delta (wraps between the 2 rows).
    void moveSelection(int delta);
    Action selectedAction() const;

private:
    QListWidget *m_list;
};
