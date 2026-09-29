# GMentor Link

A Foundry VTT module that bridges [GMentor](https://gmentor.ru/) character
sheets with Foundry VTT. Built for GURPS groups who keep their character
sheets on GMentor.

## Features

- **Character sheets in Foundry.** Open any actor's GMentor sheet in a
  movable, resizable window right inside Foundry — no separate browser tab.
  Each actor stores its own GMentor link.
- **Rolls in chat.** Dice rolls made on a GMentor sheet appear in the Foundry
  chat log, posted under the character's name. Discord-style formatting
  (bold, colored embeds, fields) is converted to Foundry chat styling.

## How it works

Players add their GMentor sheet link to an actor via the context menu in the
Actors sidebar, or the button in the actor sheet header. Only users with at
least Observer permission on an actor can open its sheet.

Roll relaying uses [ntfy.sh](https://ntfy.sh/) as a lightweight relay: the
module generates a channel URL that players paste into GMentor's roll-webhook
field. The active GM's client listens to that channel and posts incoming rolls
to chat. No server setup required.

## Requirements

- Foundry VTT v14
- A GMentor account and character sheets

## Installation

Paste the manifest URL into Foundry's **Add-on Modules → Install Module**
screen:
