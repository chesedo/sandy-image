use wasm_bindgen::prelude::wasm_bindgen;
use web_sys::console;

#[wasm_bindgen]
pub struct Image {
    elevation_data: Vec<i8>,
    grains: Vec<f32>,
    size: u32,
    width: u32,
    height: u32,
    repel_radius: u32,
    repel_radius_squared: f32,
    drag_coefficient: f32,
    elevation_offset: u32,
    elevation_offset_halfed: u32,
    left_bound: f32,
    right_bound: f32,
    top_bound: f32,
    bottom_bound: f32,
}

macro_rules ! console_log {
    ($($t:tt)*) => (console::log_1(&format_args!($($t)*).to_string().into()))
}

#[wasm_bindgen]
impl Image {
    pub fn new(elevation_data: &[u8], grains: &[f32]) -> Self {
        let elevation_data = elevation_data
            .iter()
            .map(|&i| i.try_into().unwrap_or_default())
            .collect();
        let grains = grains.to_vec();

        let size = 4;
        let width = 450;
        let height = 450;

        let repel_radius = 20;

        let elevation_offset = size - 1;
        let elevation_offset_halfed = elevation_offset / 2;

        console_log!("image ready");
        Self {
            elevation_data,
            grains,
            size,
            width,
            height,
            repel_radius,
            repel_radius_squared: (repel_radius * repel_radius) as f32,
            drag_coefficient: 0.3,

            elevation_offset,
            elevation_offset_halfed,

            left_bound: 0.0,
            right_bound: (width - size) as f32,
            top_bound: 0.0,
            bottom_bound: (height - size) as f32,
        }
    }

    pub fn update_grains(
        &mut self,
        global_vx: f32,
        global_vy: f32,
        mouse_x: f32,
        mouse_y: f32,
    ) -> js_sys::Float32Array {
        let mut elevation_data = self.elevation_data.clone();

        let repel_x_min = mouse_x - self.repel_radius as f32;
        let repel_x_max = mouse_x + self.repel_radius as f32;
        let repel_y_min = mouse_y - self.repel_radius as f32;
        let repel_y_max = mouse_y + self.repel_radius as f32;

        for i in (0..self.grains.len()).step_by(4) {
            let x = self.grains[i];
            let y = self.grains[i + 1];
            let mut vx = self.grains[i + 2];
            let mut vy = self.grains[i + 3];

            // Convert to integers for array indexing
            let x_int = x.floor() as u32;
            let y_int = y.floor() as u32;

            // The x_int and y_int are the top left corner of the grain
            // So rather calculate the gradient using the center bounds of each side
            let value_left = self.get_elevation_value(
                &elevation_data,
                x_int,
                y_int + self.elevation_offset_halfed,
            );
            let value_right = self.get_elevation_value(
                &elevation_data,
                x_int + self.elevation_offset,
                y_int + self.elevation_offset_halfed,
            );
            let value_top = self.get_elevation_value(
                &elevation_data,
                x_int + self.elevation_offset_halfed,
                y_int,
            );
            let value_bottom = self.get_elevation_value(
                &elevation_data,
                x_int + self.elevation_offset_halfed,
                y_int + self.elevation_offset,
            );

            // Calculate the gradient based on grain bounds
            let gradient_x = value_right - value_left;
            let gradient_y = value_bottom - value_top;

            vx += gradient_x as f32 + global_vx;
            vy += gradient_y as f32 + global_vy;

            // Repel from mouse if within repel radius
            if x > repel_x_min && x < repel_x_max && y > repel_y_min && y < repel_y_max {
                let dx = x - mouse_x;
                let dy = y - mouse_y;
                let distance = dx * dx + dy * dy;

                if distance < self.repel_radius_squared {
                    let distance = distance.sqrt();
                    let repel_force = self.repel_radius as f32 - distance;
                    vx += dx / distance * repel_force;
                    vy += dy / distance * repel_force;
                }
            }

            // Damper the velocity based on the size of the grain and the drag coefficient
            vx = vx.tanh() * self.drag_coefficient;
            vy = vy.tanh() * self.drag_coefficient;

            // Calculate the new position of the grain based on its velocity
            let mut x = x + vx;
            let mut y = y + vy;

            // Keep the grain within the canvas bounds and reverse its velocity if it crosses the edges
            if x < self.left_bound {
                x = self.left_bound;
                vx = -vx;
            } else if x > self.right_bound {
                x = self.right_bound;
                vx = -vx;
            }
            if y < self.top_bound {
                y = self.top_bound;
                vy = -vy;
            } else if y > self.bottom_bound {
                y = self.bottom_bound;
                vy = -vy;
            }

            // Subtract 1 from the elevation data copy below the grain
            let min_x = x.floor() as u32;
            let max_x = (x + self.size as f32).floor() as u32;
            let min_y = y.floor() as u32;
            let max_y = (y + self.size as f32).floor() as u32;

            for j in min_y..max_y {
                let row_index = j * self.width;
                for i in min_x..max_x {
                    elevation_data[(i + row_index) as usize] -= 1;
                }
            }

            // Update the grain's position and velocity in the grains array
            self.grains[i] = x;
            self.grains[i + 1] = y;
            self.grains[i + 2] = vx;
            self.grains[i + 3] = vy;
        }

        js_sys::Float32Array::from(&self.grains[..])
    }

    fn get_elevation_value(&self, elevation_data: &[i8], x: u32, y: u32) -> i8 {
        let index = x + y * self.width;
        elevation_data[index as usize]
    }
}
