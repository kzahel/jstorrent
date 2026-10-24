use std::cmp::max;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use font8x8::{BASIC_FONTS, UnicodeFonts};
use x11rb::COPY_DEPTH_FROM_PARENT;
use x11rb::connection::Connection;
use x11rb::protocol::Event;
use x11rb::protocol::xproto::ConnectionExt as _;
use x11rb::protocol::xproto::{
    AtomEnum, ConfigureWindowAux, CreateGCAux, CreateWindowAux, EventMask, Gcontext, PropMode,
    Rectangle, Window, WindowClass,
};
use x11rb::wrapper::ConnectionExt as _;

use crate::{APPLICATION_ID, SystemBackend, execute_launch};

const WORKING_WIDTH: u16 = 360;
const WORKING_HEIGHT: u16 = 104;
const FAILED_WIDTH: u16 = 520;
const FAILED_HEIGHT: u16 = 220;
const BASE_DPI: f64 = 96.0;
const COLOR_BACKGROUND: u32 = 0x0010_172A;
const COLOR_PANEL: u32 = 0x001E_293B;
const COLOR_ACCENT: u32 = 0x0022_D3EE;
const COLOR_TEXT: u32 = 0x00F8_FAFC;
const COLOR_MUTED: u32 = 0x0094_A3B8;
const MINIMUM_VISIBLE_TIME: Duration = Duration::from_millis(1200);
const SUCCESS_SETTLE_TIME: Duration = Duration::from_millis(250);
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(20);

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        WM_PROTOCOLS,
        WM_DELETE_WINDOW,
        _NET_WM_NAME,
        _NET_WM_PID,
        UTF8_STRING,
    }
}

#[derive(Clone, Copy)]
struct Layout {
    scale: u16,
    screen_width: u16,
    screen_height: u16,
}

impl Layout {
    fn from_screen(screen_width: u16, screen_height: u16, width_mm: u16, height_mm: u16) -> Self {
        let dpis = [
            calculated_dpi(screen_width, width_mm),
            calculated_dpi(screen_height, height_mm),
        ];
        let (sum, count) = dpis
            .into_iter()
            .flatten()
            .fold((0.0, 0u8), |(sum, count), dpi| {
                (sum + dpi, count.saturating_add(1))
            });
        let dpi = if count == 0 {
            BASE_DPI
        } else {
            sum / f64::from(count)
        };
        let scale = if dpi >= BASE_DPI * 2.5 {
            3
        } else if dpi >= BASE_DPI * 1.5 {
            2
        } else {
            1
        };
        Self {
            scale,
            screen_width,
            screen_height,
        }
    }

    fn dimensions(self, state: &ViewState) -> (u16, u16) {
        let (width, height) = match state {
            ViewState::Working => (WORKING_WIDTH, WORKING_HEIGHT),
            ViewState::Failed(_) => (FAILED_WIDTH, FAILED_HEIGHT),
        };
        (
            width.saturating_mul(self.scale),
            height.saturating_mul(self.scale),
        )
    }

    fn coordinate(self, value: i16) -> i16 {
        value.saturating_mul(i16::try_from(self.scale).unwrap_or(1))
    }

    fn size(self, value: u16) -> u16 {
        value.saturating_mul(self.scale)
    }
}

enum WorkerMessage {
    Finished(Result<(), String>),
}

enum ViewState {
    Working,
    Failed(String),
}

struct Graphics {
    background: Gcontext,
    panel: Gcontext,
    accent: Gcontext,
    text: Gcontext,
    muted: Gcontext,
}

pub fn run_launcher_window() -> Result<(), String> {
    let (connection, screen_number) =
        x11rb::connect(None).map_err(|error| format!("could not open Linux display: {error}"))?;
    let screen = &connection.setup().roots[screen_number];
    let layout = Layout::from_screen(
        screen.width_in_pixels,
        screen.height_in_pixels,
        screen.width_in_millimeters,
        screen.height_in_millimeters,
    );
    let state = ViewState::Working;
    let (width, height) = layout.dimensions(&state);
    let window = connection
        .generate_id()
        .map_err(|error| format!("could not allocate launcher window: {error}"))?;
    connection
        .create_window(
            COPY_DEPTH_FROM_PARENT,
            window,
            screen.root,
            centered(screen.width_in_pixels, width),
            centered(screen.height_in_pixels, height),
            width,
            height,
            0,
            WindowClass::INPUT_OUTPUT,
            0,
            &CreateWindowAux::new()
                .background_pixel(COLOR_BACKGROUND)
                .event_mask(
                    EventMask::EXPOSURE | EventMask::STRUCTURE_NOTIFY | EventMask::BUTTON_PRESS,
                ),
        )
        .map_err(|error| format!("could not create launcher window: {error}"))?
        .check()
        .map_err(|error| format!("could not create launcher window: {error}"))?;
    let atoms = Atoms::new(&connection)
        .map_err(|error| format!("could not prepare launcher properties: {error}"))?
        .reply()
        .map_err(|error| format!("could not prepare launcher properties: {error}"))?;
    set_window_properties(&connection, window, &atoms)?;
    let graphics = Graphics {
        background: create_gc(&connection, window, COLOR_BACKGROUND)?,
        panel: create_gc(&connection, window, COLOR_PANEL)?,
        accent: create_gc(&connection, window, COLOR_ACCENT)?,
        text: create_gc(&connection, window, COLOR_TEXT)?,
        muted: create_gc(&connection, window, COLOR_MUTED)?,
    };
    connection
        .map_window(window)
        .map_err(|error| format!("could not show launcher window: {error}"))?
        .check()
        .map_err(|error| format!("could not show launcher window: {error}"))?;
    connection
        .flush()
        .map_err(|error| format!("could not show launcher window: {error}"))?;

    let mapped_at = Instant::now();
    let (sender, receiver) = mpsc::channel();
    start_attempt(sender.clone());
    let mut state = state;
    let mut close_at = None;
    draw(&connection, window, layout, &graphics, &state)?;

    loop {
        drain_worker(
            &receiver,
            &mut state,
            &mut close_at,
            mapped_at,
            &connection,
            window,
            layout,
            &graphics,
        )?;
        if close_at.is_some_and(|deadline| Instant::now() >= deadline) {
            return Ok(());
        }
        while let Some(event) = connection
            .poll_for_event()
            .map_err(|error| format!("launcher event failed: {error}"))?
        {
            match event {
                Event::Expose(event) if event.count == 0 => {
                    draw(&connection, window, layout, &graphics, &state)?;
                }
                Event::ButtonPress(event)
                    if event.detail == 1 && matches!(state, ViewState::Failed(_)) =>
                {
                    state = ViewState::Working;
                    close_at = None;
                    configure_window(&connection, window, layout, &state)?;
                    draw(&connection, window, layout, &graphics, &state)?;
                    start_attempt(sender.clone());
                }
                Event::ClientMessage(event)
                    if event.format == 32
                        && event.window == window
                        && event.data.as_data32()[0] == atoms.WM_DELETE_WINDOW =>
                {
                    return Ok(());
                }
                Event::DestroyNotify(_) => return Ok(()),
                Event::Error(error) => {
                    return Err(format!("launcher protocol error: {error:?}"));
                }
                _ => {}
            }
        }
        thread::sleep(EVENT_POLL_INTERVAL);
    }
}

fn start_attempt(sender: Sender<WorkerMessage>) {
    thread::spawn(move || {
        let result = execute_launch(&SystemBackend, |_| {}).map(|_| ());
        let _ = sender.send(WorkerMessage::Finished(result));
    });
}

#[allow(clippy::too_many_arguments)]
fn drain_worker<C: Connection>(
    receiver: &Receiver<WorkerMessage>,
    state: &mut ViewState,
    close_at: &mut Option<Instant>,
    mapped_at: Instant,
    connection: &C,
    window: Window,
    layout: Layout,
    graphics: &Graphics,
) -> Result<(), String> {
    while let Ok(WorkerMessage::Finished(result)) = receiver.try_recv() {
        match result {
            Ok(()) => {
                *close_at = Some(max(
                    mapped_at + MINIMUM_VISIBLE_TIME,
                    Instant::now() + SUCCESS_SETTLE_TIME,
                ));
            }
            Err(error) => {
                *state = ViewState::Failed(error);
                configure_window(connection, window, layout, state)?;
            }
        }
        draw(connection, window, layout, graphics, state)?;
    }
    Ok(())
}

fn configure_window<C: Connection>(
    connection: &C,
    window: Window,
    layout: Layout,
    state: &ViewState,
) -> Result<(), String> {
    let (width, height) = layout.dimensions(state);
    connection
        .configure_window(
            window,
            &ConfigureWindowAux::new()
                .x(i32::from(centered(layout.screen_width, width)))
                .y(i32::from(centered(layout.screen_height, height)))
                .width(u32::from(width))
                .height(u32::from(height)),
        )
        .map_err(|error| format!("could not resize launcher: {error}"))?;
    Ok(())
}

fn set_window_properties<C: Connection>(
    connection: &C,
    window: Window,
    atoms: &Atoms,
) -> Result<(), String> {
    let title = b"Launching JSTorrent";
    connection
        .change_property8(
            PropMode::REPLACE,
            window,
            AtomEnum::WM_NAME,
            AtomEnum::STRING,
            title,
        )
        .map_err(|error| format!("could not set launcher title: {error}"))?;
    connection
        .change_property8(
            PropMode::REPLACE,
            window,
            atoms._NET_WM_NAME,
            atoms.UTF8_STRING,
            title,
        )
        .map_err(|error| format!("could not set launcher title: {error}"))?;
    connection
        .change_property8(
            PropMode::REPLACE,
            window,
            AtomEnum::WM_CLASS,
            AtomEnum::STRING,
            format!("{APPLICATION_ID}\0{APPLICATION_ID}\0").as_bytes(),
        )
        .map_err(|error| format!("could not set launcher class: {error}"))?;
    connection
        .change_property32(
            PropMode::REPLACE,
            window,
            atoms.WM_PROTOCOLS,
            AtomEnum::ATOM,
            &[atoms.WM_DELETE_WINDOW],
        )
        .map_err(|error| format!("could not set launcher close behavior: {error}"))?;
    connection
        .change_property32(
            PropMode::REPLACE,
            window,
            atoms._NET_WM_PID,
            AtomEnum::CARDINAL,
            &[std::process::id()],
        )
        .map_err(|error| format!("could not set launcher process: {error}"))?;
    Ok(())
}

fn create_gc<C: Connection>(
    connection: &C,
    window: Window,
    color: u32,
) -> Result<Gcontext, String> {
    let gc = connection
        .generate_id()
        .map_err(|error| format!("could not allocate launcher graphics: {error}"))?;
    connection
        .create_gc(gc, window, &CreateGCAux::new().foreground(color))
        .map_err(|error| format!("could not create launcher graphics: {error}"))?
        .check()
        .map_err(|error| format!("could not create launcher graphics: {error}"))?;
    Ok(gc)
}

fn draw<C: Connection>(
    connection: &C,
    window: Window,
    layout: Layout,
    graphics: &Graphics,
    state: &ViewState,
) -> Result<(), String> {
    let (width, height) = layout.dimensions(state);
    connection
        .poly_fill_rectangle(
            window,
            graphics.background,
            &[Rectangle {
                x: 0,
                y: 0,
                width,
                height,
            }],
        )
        .map_err(|error| format!("could not draw launcher: {error}"))?;
    connection
        .poly_fill_rectangle(
            window,
            graphics.panel,
            &[scaled_rectangle(
                layout,
                12,
                12,
                width / layout.scale - 24,
                80,
            )],
        )
        .map_err(|error| format!("could not draw launcher: {error}"))?;
    connection
        .poly_fill_rectangle(
            window,
            graphics.accent,
            &[scaled_rectangle(layout, 26, 28, 8, 48)],
        )
        .map_err(|error| format!("could not draw launcher: {error}"))?;
    match state {
        ViewState::Working => {
            draw_text(
                connection,
                window,
                graphics.text,
                layout,
                50,
                34,
                "JSTORRENT",
            )?;
            draw_text(
                connection,
                window,
                graphics.muted,
                layout,
                50,
                58,
                "Starting ChromeOS Linux...",
            )?;
        }
        ViewState::Failed(error) => {
            draw_text(
                connection,
                window,
                graphics.text,
                layout,
                50,
                28,
                "JSTORRENT",
            )?;
            draw_text(
                connection,
                window,
                graphics.accent,
                layout,
                50,
                50,
                "COULD NOT OPEN",
            )?;
            for (index, line) in wrap_text(error, 52).into_iter().take(4).enumerate() {
                draw_text(
                    connection,
                    window,
                    graphics.muted,
                    layout,
                    26,
                    90 + i16::try_from(index).unwrap_or(0) * 18,
                    &line,
                )?;
            }
            draw_text(
                connection,
                window,
                graphics.text,
                layout,
                26,
                184,
                "CLICK TO TRY AGAIN",
            )?;
        }
    }
    connection
        .flush()
        .map_err(|error| format!("could not present launcher: {error}"))
}

fn draw_text<C: Connection>(
    connection: &C,
    window: Window,
    gc: Gcontext,
    layout: Layout,
    x: i16,
    y: i16,
    text: &str,
) -> Result<(), String> {
    let pixel = layout.scale.max(1);
    let mut rectangles = Vec::new();
    for (character_index, character) in text.to_ascii_uppercase().chars().enumerate() {
        let Some(glyph) = BASIC_FONTS.get(character) else {
            continue;
        };
        let character_x = x.saturating_add(
            i16::try_from(character_index)
                .unwrap_or(i16::MAX)
                .saturating_mul(9),
        );
        for (row, bits) in glyph.into_iter().enumerate() {
            for column in 0..8u8 {
                if bits & (1 << column) != 0 {
                    rectangles.push(Rectangle {
                        x: layout.coordinate(character_x.saturating_add(i16::from(column))),
                        y: layout.coordinate(y.saturating_add(i16::try_from(row).unwrap_or(0))),
                        width: pixel,
                        height: pixel,
                    });
                }
            }
        }
    }
    connection
        .poly_fill_rectangle(window, gc, &rectangles)
        .map_err(|error| format!("could not draw launcher text: {error}"))?;
    Ok(())
}

fn wrap_text(value: &str, width: usize) -> Vec<String> {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in cleaned.split_whitespace() {
        if !current.is_empty() && current.len() + 1 + word.len() > width {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&word[..word.floor_char_boundary(width.min(word.len()))]);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push("Unknown launch failure".to_owned());
    }
    lines
}

fn scaled_rectangle(layout: Layout, x: i16, y: i16, width: u16, height: u16) -> Rectangle {
    Rectangle {
        x: layout.coordinate(x),
        y: layout.coordinate(y),
        width: layout.size(width),
        height: layout.size(height),
    }
}

fn calculated_dpi(pixels: u16, millimeters: u16) -> Option<f64> {
    (millimeters > 0).then(|| f64::from(pixels) * 25.4 / f64::from(millimeters))
}

fn centered(screen: u16, window: u16) -> i16 {
    i16::try_from(screen.saturating_sub(window) / 2).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chromeos_density_is_bounded_and_dimensions_fit() {
        let layout = Layout::from_screen(1920, 1080, 210, 118);
        assert_eq!(layout.scale, 2);
        assert_eq!(layout.dimensions(&ViewState::Working), (720, 208));
        let unknown = Layout::from_screen(1920, 1080, 0, 0);
        assert_eq!(unknown.scale, 1);
    }

    #[test]
    fn error_copy_is_control_free_and_bounded_by_lines() {
        let lines = wrap_text(
            "could not start\nservice because the listener was unavailable",
            24,
        );
        assert!(lines.iter().all(|line| line.len() <= 24));
        assert!(lines.iter().all(|line| !line.contains('\n')));
    }
}
