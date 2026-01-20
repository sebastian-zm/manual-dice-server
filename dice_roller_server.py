#!/usr/bin/env python3
import asyncio
import random
import signal
import sys
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk

app = Server('dice-roller')

class DiceRollDialog(Gtk.Dialog):
    def __init__(self, dice_specs):
        super().__init__(title='🎲 Dice Roller')
        self.dice_specs = dice_specs
        self.spinbuttons = []
        self.set_default_size(320, -1)
        self.set_border_width(16)
        self.setup_ui()

    def setup_ui(self):
        box = self.get_content_area()
        box.set_spacing(10)
        title = Gtk.Label()
        title.set_markup('<span font_weight="bold" font_size="large">Enter your dice rolls</span>')
        box.pack_start(title, False, False, 8)
        box.pack_start(Gtk.Separator(), False, False, 4)
        for dice_spec in self.dice_specs:
            die_type = dice_spec['die']
            amount = dice_spec.get('amount', 1)
            for i in range(amount):
                hbox = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
                hbox.set_margin_start(8)
                hbox.set_margin_end(8)
                label_text = f'd{die_type} (roll {i+1}/{amount})' if amount > 1 else f'd{die_type}'
                label = Gtk.Label(label=label_text)
                label.set_xalign(0)
                label.set_width_chars(16)
                adj = Gtk.Adjustment(value=1, lower=1, upper=die_type, step_increment=1)
                spinbutton = Gtk.SpinButton()
                spinbutton.set_adjustment(adj)
                spinbutton.set_numeric(True)
                spinbutton.set_width_chars(6)
                self.spinbuttons.append(spinbutton)
                hbox.pack_start(label, False, False, 0)
                hbox.pack_start(spinbutton, False, False, 0)
                box.pack_start(hbox, False, False, 2)
        box.pack_start(Gtk.Separator(), False, False, 4)
        cancel_btn = self.add_button('Cancel', Gtk.ResponseType.CANCEL)
        ok_btn = self.add_button('Roll 🎲', Gtk.ResponseType.OK)
        ok_btn.get_style_context().add_class('suggested-action')
        self.set_default_response(Gtk.ResponseType.OK)
        self.show_all()

    def get_results(self):
        return [int(sb.get_value()) for sb in self.spinbuttons]

def prompt_user_for_rolls(dice_specs):
    dialog = DiceRollDialog(dice_specs)
    response = dialog.run()
    if response == Gtk.ResponseType.OK:
        results = dialog.get_results()
        dialog.destroy()
        while Gtk.events_pending():
            Gtk.main_iteration()
        return results
    dialog.destroy()
    while Gtk.events_pending():
        Gtk.main_iteration()
    raise ValueError('User cancelled the dice roll')

def system_roll(die_type):
    return random.randint(1, die_type)

@app.list_tools()
async def list_tools():
    return [Tool(
        name='roll_dice',
        description='Roll dice either manually (user inputs results via dialog) or automatically (system generates random results). Accepts an array of dice specifications.',
        inputSchema={
            'type': 'object',
            'properties': {
                'dice': {
                    'type': 'array',
                    'description': 'Array of dice to roll',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'die': {
                                'type': 'integer',
                                'description': 'Type of die (e.g., 6, 8, 12, 20)'
                            },
                            'amount': {
                                'type': 'integer',
                                'description': 'Number of times to roll this die (default: 1)',
                                'default': 1
                            }
                        },
                        'required': ['die']
                    }
                },
                'mode': {
                    'type': 'string',
                    'description': 'Rolling mode: manual for user input via dialog, auto for system-generated random rolls',
                    'enum': ['manual', 'auto'],
                    'default': 'auto'
                }
            },
            'required': ['dice']
        }
    )]

@app.call_tool()
async def handle_call_tool(name, arguments):
    if name != 'roll_dice':
        raise ValueError(f'Unknown tool: {name}')
    dice = arguments.get('dice', [])
    mode = arguments.get('mode', 'auto')
    if not dice:
        return [TextContent(type='text', text='Error: No dice specified')]
    try:
        if mode == 'manual':
            all_rolls = prompt_user_for_rolls(dice)
            results, idx = [], 0
            for dice_spec in dice:
                die_type, amount = dice_spec['die'], dice_spec.get('amount', 1)
                rolls = all_rolls[idx:idx+amount]
                idx += amount
                if amount == 1:
                    results.append(f'd{die_type}: {rolls[0]}')
                else:
                    results.append(f'{amount}d{die_type}: [{", ".join(map(str, rolls))}] (total: {sum(rolls)})')
        else:
            results = []
            for dice_spec in dice:
                die_type, amount = dice_spec['die'], dice_spec.get('amount', 1)
                rolls = [system_roll(die_type) for _ in range(amount)]
                if amount == 1:
                    results.append(f'd{die_type}: {rolls[0]}')
                else:
                    results.append(f'{amount}d{die_type}: [{", ".join(map(str, rolls))}] (total: {sum(rolls)})')
        return [TextContent(type='text', text=f'({"manual" if mode == "manual" else "auto"})\n' + '\n'.join(results))]
    except ValueError as e:
        return [TextContent(type='text', text=f'Error: {str(e)}')]
    except Exception as e:
        return [TextContent(type='text', text=f'Unexpected error: {str(e)}')]

def main():
    # Handle SIGTERM (signal 15) for graceful shutdown.
    # Note: SIGKILL (signal 9) cannot be caught or ignored by design in Unix-like systems.
    signal.signal(signal.SIGTERM, lambda sig, frame: sys.exit(0))

    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        # Handle SIGINT (Ctrl+C)
        sys.exit(0)

async def async_main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == '__main__':
    main()
