use std::vec;

use wasm_bindgen::prelude::wasm_bindgen;

struct Grain {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
}

impl Grain {
    /// Move the grain down the hill based on the elevation data
    #[inline]
    fn move_down_hill(
        &mut self,
        elevation_data: &[i8],
        offset: u32,
        offset_halfed: u32,
        width: u32,
    ) {
        // Convert to integers for array indexing
        let x_int = self.x.floor() as u32;
        let y_int = self.y.floor() as u32;

        // The x_int and y_int are the top left corner of the grain
        // So rather calculate the gradient using the center bounds of each side
        self.move_down_hill_x(elevation_data, x_int, y_int + offset_halfed, offset, width);
        self.move_down_hill_y(elevation_data, x_int + offset_halfed, y_int, offset, width);
    }

    #[inline]
    fn move_down_hill_x(&mut self, elevation_data: &[i8], x: u32, y: u32, offset: u32, width: u32) {
        let value_left = Self::get_elevation_value(elevation_data, x, y, width);
        let value_right = Self::get_elevation_value(elevation_data, x + offset, y, width);

        let gradient = value_right - value_left;
        self.vx += gradient as f32;
    }

    #[inline]
    fn move_down_hill_y(&mut self, elevation_data: &[i8], x: u32, y: u32, offset: u32, width: u32) {
        let value_top = Self::get_elevation_value(elevation_data, x, y, width);
        let value_bottom = Self::get_elevation_value(elevation_data, x, y + offset, width);

        let gradient = value_bottom - value_top;
        self.vy += gradient as f32;
    }

    #[inline]
    fn get_elevation_value(elevation_data: &[i8], x: u32, y: u32, width: u32) -> i8 {
        let index = x + y * width;
        elevation_data[index as usize]
    }

    /// Update the position of the grain and keep it within the bounds
    #[inline]
    fn update_position(
        &mut self,
        left_bound: f32,
        right_bound: f32,
        top_bound: f32,
        bottom_bound: f32,
        damping_factor: f32,
    ) {
        self.apply_damping(damping_factor);

        // Calculate the new position of the grain based on its velocity
        self.x += self.vx;
        self.y += self.vy;

        self.keep_witin_bounds(left_bound, right_bound, top_bound, bottom_bound);
    }

    /// Damper the velocity based on the damping factor
    #[inline]
    fn apply_damping(&mut self, damping_factor: f32) {
        self.vx = self.vx.clamp(-1 as f32, 1 as f32);
        self.vy = self.vy.clamp(-1 as f32, 1 as f32);

        self.vx *= damping_factor;
        self.vy *= damping_factor;
    }

    /// Keep the grain within the canvas bounds and reverse its velocity if it crosses the edges
    #[inline]
    fn keep_witin_bounds(
        &mut self,
        left_bound: f32,
        right_bound: f32,
        top_bound: f32,
        bottom_bound: f32,
    ) {
        if self.x < left_bound {
            self.x = left_bound;
            self.vx = -self.vx;
        } else if self.x > right_bound {
            self.x = right_bound;
            self.vx = -self.vx;
        }

        if self.y < top_bound {
            self.y = top_bound;
            self.vy = -self.vy;
        } else if self.y > bottom_bound {
            self.y = bottom_bound;
            self.vy = -self.vy;
        }
    }

    /// Repel from mouse if within repel radius
    fn repel_from_mouse(
        &mut self,
        mouse_x: f32,
        mouse_y: f32,
        repel_x_min: f32,
        repel_x_max: f32,
        repel_y_min: f32,
        repel_y_max: f32,
        repel_radius_squared: f32,
    ) {
        if self.x > repel_x_min
            && self.x < repel_x_max
            && self.y > repel_y_min
            && self.y < repel_y_max
        {
            let dx = self.x - mouse_x;
            let dy = self.y - mouse_y;
            let distance_squared = dx * dx + dy * dy;

            if distance_squared < repel_radius_squared {
                let distance = distance_squared.sqrt();

                self.vx += dx / distance;
                self.vy += dy / distance;
            }
        }
    }
}

#[wasm_bindgen]
pub struct Image {
    elevation_data: Vec<i8>,
    grains: Vec<Grain>,
    size: u32,
    width: u32,
    height: u32,
    repel_radius: u32,
    repel_radius_squared: f32,
    damping_factor: f32,
    elevation_offset: u32,
    elevation_offset_halfed: u32,
    left_bound: f32,
    right_bound: f32,
    top_bound: f32,
    bottom_bound: f32,
}

#[wasm_bindgen]
impl Image {
    pub fn new(
        elevation_data: &[u8],
        grains: &[f32],
        size: u32,
        width: u32,
        height: u32,
        damping_factor: f32,
        repel_radius: u32,
    ) -> Self {
        let elevation_data = elevation_data
            .iter()
            .map(|&i| i.try_into().unwrap_or_default())
            .collect();
        let grains = grains
            .chunks(4)
            .map(|g| Grain {
                x: g[0],
                y: g[1],
                vx: g[2],
                vy: g[3],
            })
            .collect();

        let elevation_offset = size - 1;
        let elevation_offset_halfed = elevation_offset / 2;

        Self {
            elevation_data,
            grains,
            size,
            width,
            height,
            repel_radius,
            repel_radius_squared: (repel_radius * repel_radius) as f32,
            damping_factor,

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

        for grain in self.grains.iter_mut() {
            grain.move_down_hill(
                &elevation_data,
                self.elevation_offset,
                self.elevation_offset_halfed,
                self.width,
            );

            // Apply global breeze
            grain.vx += global_vx;
            grain.vy += global_vy;

            grain.repel_from_mouse(
                mouse_x,
                mouse_y,
                repel_x_min,
                repel_x_max,
                repel_y_min,
                repel_y_max,
                self.repel_radius_squared,
            );

            grain.update_position(
                self.left_bound,
                self.right_bound,
                self.top_bound,
                self.bottom_bound,
                self.damping_factor,
            );

            Self::update_elevation_data(grain, &mut elevation_data, self.size, self.width);
        }

        let positions: Vec<f32> = self.grains.iter().flat_map(|g| vec![g.x, g.y]).collect();
        js_sys::Float32Array::from(positions.as_slice())
    }

    /// Subtract 1 from the elevation data copy below the grain
    #[inline]
    fn update_elevation_data(grain: &Grain, elevation_data: &mut Vec<i8>, size: u32, width: u32) {
        let start_x = grain.x.floor() as u32;
        let start_y = grain.y.floor() as u32;

        (0..size).for_each(|col| {
            (0..size).for_each(|row| {
                let row_index = (row + start_y) * width;
                elevation_data[(col + start_x + row_index) as usize] -= 1;
            });
        });
    }
}
