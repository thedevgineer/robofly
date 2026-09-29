//! Live tick. The arithmetic matches `sim/network.py` and `sim/world.py`.

use std::sync::Mutex;

const N: usize = 256;
const MAX_FOODS: usize = 6;
const MAX_THREATS: usize = 4;
const MAX_PADS: usize = 4;
const MAX_WALLS: usize = 8;
const BODY: f64 = 0.18;
const VISION_RANGE: f64 = 2.3;
const LOOM_RANGE: f64 = 7.0;
const PREDATOR_SPEED: f64 = 0.06;
const PREDATOR_DRAG: f64 = 0.88;
const FLY_DRAG: f64 = 0.88;
const MAX_FLY_SPEED: f64 = 0.24;
const FLOOR_Z: f64 = 0.12;
const CEILING_Z: f64 = 2.35;
const DECAY: f32 = 0.92;
const THRESHOLD: f32 = 1.0;

const MOTOR_COUNT: usize = 12;
const SNAP_LEN: usize = 7144;
const LAYOUT_LEN: usize = 792;

static SIM: Mutex<Option<Sim>> = Mutex::new(None);

struct Obj {
    x: f64,
    y: f64,
    z: f64,
    r: f64,
    vx: f64,
    vy: f64,
    vz: f64,
}

#[derive(Clone, Copy)]
struct Wall {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

struct Topology {
    edges: usize,
    pre: Vec<i32>,
    post: Vec<i32>,
    weight: Vec<f32>,
    motor_index: [i16; N],
}

struct Sim {
    topology: Topology,
    v: [f32; N],
    refractory: [i16; N],
    last_spikes: [u8; N],
    cycles: u32,
    ticks: u32,
    pose_x: f64,
    pose_y: f64,
    pose_z: f64,
    pose_yaw: f64,
    pose_pitch: f64,
    pose_speed: f64,
    pose_vx: f64,
    pose_vy: f64,
    pose_vz: f64,
    yaw_rate: f64,
    room_min_x: f64,
    room_max_x: f64,
    room_min_y: f64,
    room_max_y: f64,
    foods: Vec<Obj>,
    threats: Vec<Obj>,
    landings: Vec<Obj>,
    walls: Vec<Wall>,
    eaten: bool,
    started_with_food: bool,
    predator_speed: f64,
    escape_hold: i32,
    hold: i32,
    start_pose: [f64; 5],
    start_foods: Vec<Obj>,
    start_threats: Vec<Obj>,
    start_landings: Vec<Obj>,
    snap: Vec<u8>,
    layout: Vec<u8>,
}

fn topology() -> Topology {
    let bytes = include_bytes!("../topology.bin");
    assert!(bytes.len() >= 16, "topology blob is short");
    assert!(&bytes[0..4] == b"RFLY", "topology magic");
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let n = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let edges = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    assert!(version == 1 && n == N, "topology header");
    let mut cursor = 16;
    let pre = read_i32(bytes, &mut cursor, edges);
    let post = read_i32(bytes, &mut cursor, edges);
    let weight = read_f32(bytes, &mut cursor, edges);
    let mut motor_index = [-1i16; N];
    for slot in &mut motor_index {
        *slot = i16::from_le_bytes(bytes[cursor..cursor + 2].try_into().unwrap());
        cursor += 2;
    }
    Topology {
        edges,
        pre,
        post,
        weight,
        motor_index,
    }
}

fn read_i32(bytes: &[u8], cursor: &mut usize, count: usize) -> Vec<i32> {
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        out.push(i32::from_le_bytes(bytes[*cursor..*cursor + 4].try_into().unwrap()));
        *cursor += 4;
    }
    out
}

fn read_f32(bytes: &[u8], cursor: &mut usize, count: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        out.push(f32::from_le_bytes(bytes[*cursor..*cursor + 4].try_into().unwrap()));
        *cursor += 4;
    }
    out
}

fn with_sim<T>(f: impl FnOnce(&mut Sim) -> T) -> T {
    let mut guard = SIM.lock().expect("sim lock");
    if guard.is_none() {
        *guard = Some(Sim::boot());
    }
    f(guard.as_mut().expect("sim"))
}

impl Sim {
    fn boot() -> Self {
        let mut sim = Self {
            topology: topology(),
            v: [0.0; N],
            refractory: [0; N],
            last_spikes: [0; N],
            cycles: 0,
            ticks: 0,
            pose_x: 0.0,
            pose_y: 0.0,
            pose_z: 1.0,
            pose_yaw: 0.0,
            pose_pitch: 0.0,
            pose_speed: 0.0,
            pose_vx: 0.0,
            pose_vy: 0.0,
            pose_vz: 0.0,
            yaw_rate: 0.0,
            room_min_x: -12.0,
            room_max_x: 24.0,
            room_min_y: -12.0,
            room_max_y: 18.0,
            foods: Vec::new(),
            threats: Vec::new(),
            landings: Vec::new(),
            walls: Vec::new(),
            eaten: false,
            started_with_food: false,
            predator_speed: 0.0,
            escape_hold: 0,
            hold: 0,
            start_pose: [0.0, 0.0, 1.0, 0.0, 0.0],
            start_foods: Vec::new(),
            start_threats: Vec::new(),
            start_landings: Vec::new(),
            snap: vec![0; SNAP_LEN],
            layout: vec![0; LAYOUT_LEN],
        };
        sim.apply_scenario(0);
        sim
    }

    fn clear_brain(&mut self) {
        self.v = [0.0; N];
        self.refractory = [0; N];
        self.last_spikes = [0; N];
        self.cycles = 0;
        self.ticks = 0;
        self.eaten = false;
        self.escape_hold = 0;
        self.hold = 0;
        self.pose_speed = 0.0;
        self.pose_vx = 0.0;
        self.pose_vy = 0.0;
        self.pose_vz = 0.0;
        self.yaw_rate = 0.0;
    }

    fn remember_start(&mut self) {
        self.start_pose = [self.pose_x, self.pose_y, self.pose_z, self.pose_yaw, self.pose_pitch];
        self.start_foods = self.foods.clone();
        self.start_threats = self.threats.clone();
        self.start_landings = self.landings.iter().filter(|item| self.inside_xy(item.x, item.y)).cloned().collect();
        self.write_layout();
        self.write_snap(None);
    }

    fn apply_scenario(&mut self, scenario: u32) {
        self.clear_brain();
        self.pose_x = 0.0;
        self.pose_y = 0.0;
        self.pose_z = 1.0;
        self.pose_yaw = 0.0;
        self.pose_pitch = 0.0;
        self.foods.clear();
        self.threats.clear();
        self.walls.clear();
        self.landings.clear();
        self.predator_speed = 0.0;
        let far = still_obj(40.0, 40.0, 0.15, 0.5);
        self.landings.push(far);
        match scenario {
            0 => {
                self.room_min_x = -12.0;
                self.room_max_x = 24.0;
                self.room_min_y = -12.0;
                self.room_max_y = 18.0;
                self.foods.push(still_obj(2.4, 1.9, 1.0, 0.45));
            }
            1 => {
                self.room_min_x = -3.45;
                self.room_max_x = 3.45;
                self.room_min_y = -3.45;
                self.room_max_y = 3.45;
                self.pose_x = 0.35;
                self.pose_y = 0.0;
                self.pose_z = 1.5;
                self.pose_yaw = 0.6;
                self.threats.push(still_obj(-0.65, 0.2, 0.42, 0.4));
                self.predator_speed = PREDATOR_SPEED;
            }
            2 => {
                self.room_min_x = -9.0;
                self.room_max_x = 24.0;
                self.room_min_y = -9.0;
                self.room_max_y = 12.0;
                self.walls.push(Wall { min_x: 1.55, max_x: 2.15, min_y: -2.2, max_y: 0.45 });
                self.foods.push(still_obj(4.2, 1.8, 1.0, 0.45));
            }
            3 => {
                self.room_min_x = -12.0;
                self.room_max_x = 15.0;
                self.room_min_y = -12.0;
                self.room_max_y = 12.0;
                self.landings.clear();
                self.landings.push(still_obj(0.15, 0.0, 0.12, 0.7));
            }
            _ => {
                self.room_min_x = -24.0;
                self.room_max_x = 24.0;
                self.room_min_y = -24.0;
                self.room_max_y = 24.0;
            }
        }
        self.started_with_food = !self.foods.is_empty();
        self.remember_start();
    }

    fn inside_xy(&self, x: f64, y: f64) -> bool {
        self.room_min_x <= x && x <= self.room_max_x && self.room_min_y <= y && y <= self.room_max_y
    }

    fn set_layout(&mut self, bytes: &[u8]) -> i32 {
        if bytes.len() < 88 {
            return 1;
        }
        let mut cursor = 0;
        let room_min_x = read_f64(bytes, &mut cursor);
        let room_max_x = read_f64(bytes, &mut cursor);
        let room_min_y = read_f64(bytes, &mut cursor);
        let room_max_y = read_f64(bytes, &mut cursor);
        if room_max_x <= room_min_x || room_max_y <= room_min_y {
            return 1;
        }
        let pose_x = read_f64(bytes, &mut cursor);
        let pose_y = read_f64(bytes, &mut cursor);
        let pose_z = read_f64(bytes, &mut cursor);
        let pose_yaw = read_f64(bytes, &mut cursor);
        let pose_pitch = read_f64(bytes, &mut cursor);
        let n_foods = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let n_threats = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let n_lands = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let n_walls = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        if n_foods > MAX_FOODS || n_threats > MAX_THREATS || n_lands > MAX_PADS || n_walls > MAX_WALLS {
            return 2;
        }
        let need = 88 + (n_foods + n_threats + n_lands) * 32 + n_walls * 32;
        if bytes.len() < need {
            return 1;
        }
        let mut foods = Vec::new();
        let mut threats = Vec::new();
        let mut landings = Vec::new();
        let mut walls = Vec::new();
        for _ in 0..n_foods {
            foods.push(read_obj(bytes, &mut cursor));
        }
        for _ in 0..n_threats {
            threats.push(read_obj(bytes, &mut cursor));
        }
        for _ in 0..n_lands {
            landings.push(read_obj(bytes, &mut cursor));
        }
        for _ in 0..n_walls {
            let min_x = read_f64(bytes, &mut cursor);
            let max_x = read_f64(bytes, &mut cursor);
            let min_y = read_f64(bytes, &mut cursor);
            let max_y = read_f64(bytes, &mut cursor);
            if max_x <= min_x || max_y <= min_y {
                return 4;
            }
            walls.push(Wall { min_x, max_x, min_y, max_y });
        }
        let inside = |x: f64, y: f64| room_min_x <= x && x <= room_max_x && room_min_y <= y && y <= room_max_y;
        if !inside(pose_x, pose_y) {
            return 3;
        }
        for item in foods.iter().chain(threats.iter()).chain(landings.iter()) {
            if !inside(item.x, item.y) {
                return 3;
            }
        }
        for wall in &walls {
            if !inside(wall.min_x, wall.min_y) || !inside(wall.max_x, wall.max_y) {
                return 3;
            }
        }
        self.clear_brain();
        self.room_min_x = room_min_x;
        self.room_max_x = room_max_x;
        self.room_min_y = room_min_y;
        self.room_max_y = room_max_y;
        self.pose_x = pose_x;
        self.pose_y = pose_y;
        self.pose_z = pose_z;
        self.pose_yaw = pose_yaw;
        self.pose_pitch = pose_pitch;
        self.foods = foods;
        self.threats = threats;
        self.landings = landings;
        self.walls = walls;
        self.started_with_food = !self.foods.is_empty();
        self.predator_speed = if self.threats.is_empty() { 0.0 } else { PREDATOR_SPEED };
        self.remember_start();
        0
    }

    fn step(&mut self) {
        self.advance_predators();
        let drive = self.encode_sensors();
        let stage = self.step_network(&drive);
        let mut rates = self.motor_rates();
        if self.hold > 0 {
            let slot = (self.hold - 1) as usize;
            if slot < MOTOR_COUNT {
                rates = [0.0; MOTOR_COUNT];
                rates[slot] = 1.0;
            }
        }
        self.apply_motors(rates);
        self.resolve_solids();
        self.try_eat();
        self.ticks += 1;
        self.write_snap(Some(stage));
    }

    fn step_network(&mut self, drive: &[f32; N]) -> Stage {
        let mut acc = *drive;
        let topo = &self.topology;
        for edge in 0..topo.edges {
            let pre = topo.pre[edge] as usize;
            let post = topo.post[edge] as usize;
            acc[post] += (self.last_spikes[pre] as f32) * topo.weight[edge];
        }
        let mut stage = Stage::default();
        let mut nonzero = 0u32;
        for i in 0..N {
            if drive[i] != 0.0 {
                nonzero += 1;
            }
            let active = self.refractory[i] <= 0;
            let held = self.v[i];
            let decayed = if active { held * DECAY } else { 0.0 };
            let sum = if active { decayed + acc[i] } else { 0.0 };
            let spike = active && sum >= THRESHOLD;
            stage.held[i] = held;
            stage.decayed[i] = decayed;
            stage.drive[i] = drive[i];
            stage.input[i] = acc[i];
            stage.sum[i] = sum;
            stage.spike[i] = u8::from(spike);
            self.v[i] = if spike { 0.0 } else { sum };
            let mut refr = self.refractory[i] - 1;
            if refr < 0 {
                refr = 0;
            }
            if spike {
                refr = 2;
            }
            self.refractory[i] = refr;
            stage.refractory[i] = refr.max(0) as u8;
            self.last_spikes[i] = u8::from(spike);
        }
        self.cycles += (N + topo.edges) as u32 + nonzero;
        stage.nonzero = nonzero;
        stage
    }

    fn motor_rates(&self) -> [f32; MOTOR_COUNT] {
        let mut sums = [0u32; MOTOR_COUNT];
        let mut counts = [0u32; MOTOR_COUNT];
        for i in 0..N {
            let index = self.topology.motor_index[i];
            if index >= 0 {
                let slot = index as usize;
                if slot < MOTOR_COUNT {
                    counts[slot] += 1;
                    sums[slot] += self.last_spikes[i] as u32;
                }
            }
        }
        let mut rates = [0.0; MOTOR_COUNT];
        for slot in 0..MOTOR_COUNT {
            if counts[slot] > 0 {
                rates[slot] = sums[slot] as f32 / counts[slot] as f32;
            }
        }
        rates
    }

    fn advance_predators(&mut self) {
        if self.predator_speed <= 0.0 {
            return;
        }
        let pose_x = self.pose_x;
        let pose_y = self.pose_y;
        let pose_z = self.pose_z;
        let room = (self.room_min_x, self.room_max_x, self.room_min_y, self.room_max_y);
        let max_speed = self.predator_speed;
        for threat in &mut self.threats {
            let dx = pose_x - threat.x;
            let dy = pose_y - threat.y;
            let dz = pose_z - threat.z;
            let dist = speed_of(dx, dy, dz);
            let closing = if dist <= 0.28 { 0.0 } else { 1.0f64.min((dist - 0.28) / 0.35) };
            if dist > 1e-8 && closing > 0.0 {
                let accel = max_speed * (1.0 - PREDATOR_DRAG) * closing;
                threat.vx = threat.vx * PREDATOR_DRAG + (dx / dist) * accel;
                threat.vy = threat.vy * PREDATOR_DRAG + (dy / dist) * accel;
                threat.vz = threat.vz * PREDATOR_DRAG + (dz / dist) * accel;
            } else {
                threat.vx *= PREDATOR_DRAG;
                threat.vy *= PREDATOR_DRAG;
                threat.vz *= PREDATOR_DRAG;
            }
            let (vx, vy, vz, _) = limit_velocity(threat.vx, threat.vy, threat.vz, max_speed);
            threat.vx = vx;
            threat.vy = vy;
            threat.vz = vz;
            threat.x += threat.vx;
            threat.y += threat.vy;
            threat.z += threat.vz;
            let (x, y, z, vx, vy, vz) = contain(threat.x, threat.y, threat.z, threat.vx, threat.vy, threat.vz, room, threat.r, threat.r);
            threat.x = x;
            threat.y = y;
            threat.z = z;
            threat.vx = vx;
            threat.vy = vy;
            threat.vz = vz;
        }
    }

    fn encode_sensors(&self) -> [f32; N] {
        let mut drive = [0.0f32; N];
        if let Some((food, dist)) = nearest(&self.foods, self.pose_x, self.pose_y) {
            let food_dist = dist.max(0.001);
            let food_angle = angle_delta((food.y - self.pose_y).atan2(food.x - self.pose_x), self.pose_yaw);
            let odor = (-food_dist / 3.2).exp();
            let forward = odor * food_angle.cos().max(0.0);
            let left = odor * food_angle.sin().max(0.0);
            let right = odor * (-food_angle.sin()).max(0.0);
            let left_drive = (forward + left) as f32;
            let right_drive = (forward + right) as f32;
            for slot in 64..72 {
                drive[slot] = left_drive;
            }
            for slot in 72..80 {
                drive[slot] = right_drive;
            }
        }
        let mut nearest_pad: Option<(f64, f64)> = None;
        for pad in &self.landings {
            let dist = (pad.x - self.pose_x).hypot(pad.y - self.pose_y);
            let angle = angle_delta((pad.y - self.pose_y).atan2(pad.x - self.pose_x), self.pose_yaw);
            if dist < 2.4 && angle.abs() < std::f64::consts::PI / 2.0 && nearest_pad.map(|item| dist < item.0).unwrap_or(true) {
                nearest_pad = Some((dist, dist));
            }
        }
        if let Some((dist, _)) = nearest_pad {
            let value = (0.35f64).max(1.0 - dist / 2.4) as f32;
            for slot in 80..88 {
                drive[slot] = value;
            }
        }
        if let Some((_, dist)) = nearest_volume(&self.threats, self.pose_x, self.pose_y, self.pose_z) {
            if dist < LOOM_RANGE {
                let value = ((LOOM_RANGE - dist) / LOOM_RANGE) as f32;
                for slot in 88..96 {
                    drive[slot] = value;
                }
            }
        }
        for i in 0..64 {
            let ray_angle = self.pose_yaw + (i as f64 / 63.0 - 0.5) * std::f64::consts::PI;
            let dx = ray_angle.cos();
            let dy = ray_angle.sin();
            let mut dist = ray_room(self.pose_x, self.pose_y, dx, dy, self.room_min_x, self.room_max_x, self.room_min_y, self.room_max_y);
            for wall in &self.walls {
                if let Some(hit) = ray_box(self.pose_x, self.pose_y, dx, dy, wall) {
                    dist = dist.min(hit);
                }
            }
            if dist < VISION_RANGE {
                drive[i] = ((VISION_RANGE - dist) / VISION_RANGE) as f32;
            }
        }
        let pad_near = self.landings.iter().any(|pad| {
            let dist = (pad.x - self.pose_x).hypot(pad.y - self.pose_y);
            let angle = angle_delta((pad.y - self.pose_y).atan2(pad.x - self.pose_x), self.pose_yaw);
            dist < 2.4 && angle.abs() < std::f64::consts::PI / 2.0
        });
        let quiet = self.foods.is_empty()
            && !pad_near
            && nearest_volume(&self.threats, self.pose_x, self.pose_y, self.pose_z)
                .map(|(_, dist)| dist >= LOOM_RANGE)
                .unwrap_or(true);
        if quiet {
            drive[254] = 1.05;
            drive[255] = 1.05;
            if self.ticks % 11 == 0 {
                drive[246] = 1.05;
                drive[247] = 1.05;
            }
        }
        drive
    }

    fn apply_motors(&mut self, rates: [f32; MOTOR_COUNT]) {
        let escape = rates[5] as f64;
        let thrust = rates[0] as f64;
        let yaw_left = rates[1] as f64;
        let yaw_right = rates[2] as f64;
        let pitch_up = rates[3] as f64;
        let land = rates[4] as f64;
        let walk = rates[6] as f64;
        let groom = (rates[7] as f64).max(rates[8] as f64).max(rates[9] as f64);
        let feed = rates[10] as f64;
        let rest = rates[11] as f64;
        let gesture = groom.max(feed).max(rest);
        if escape >= 0.5 {
            self.escape_hold = 6;
        } else if self.escape_hold > 0 {
            self.escape_hold -= 1;
        }
        let fleeing = escape >= 0.5 || self.escape_hold > 0;
        let yaw_cmd = if fleeing { 0.16 } else { 0.28 * (yaw_left - yaw_right) };
        self.yaw_rate = self.yaw_rate * 0.75 + yaw_cmd * 0.25;
        self.pose_yaw += self.yaw_rate;
        let walking = !fleeing && walk >= 0.5 && walk > thrust;
        let settling = !fleeing && land < 0.5 && gesture >= 0.5 && gesture > thrust && gesture > walk;
        let threat_far = nearest_volume(&self.threats, self.pose_x, self.pose_y, self.pose_z)
            .map(|(_, dist)| dist >= LOOM_RANGE)
            .unwrap_or(true);
        let body_idle = self.foods.is_empty() && threat_far && !fleeing && land < 0.5 && thrust < 0.5 && walk < 0.5;
        let (forward, lift) = if fleeing {
            self.pose_pitch = 0.82 * self.pose_pitch + 0.18 * 0.65;
            (0.03, 0.018)
        } else if body_idle {
            let landed = self.pose_z <= FLOOR_Z + 0.05;
            self.pose_pitch = 0.82 * self.pose_pitch + if landed { 0.0 } else { 0.18 * -0.4 };
            (0.0, if landed { 0.0 } else { -0.03 })
        } else if walking {
            self.pose_pitch = 0.82 * self.pose_pitch + 0.18 * (pitch_up - land);
            (0.012, if self.pose_z > FLOOR_Z + 0.28 { -0.016 } else { 0.0 })
        } else if settling {
            let landed = self.pose_z <= FLOOR_Z + 0.05;
            self.pose_pitch = 0.82 * self.pose_pitch + if landed { 0.0 } else { 0.18 * -0.4 };
            (0.0, if landed { 0.0 } else { -0.03 })
        } else {
            self.pose_pitch = 0.82 * self.pose_pitch + 0.18 * (pitch_up - land);
            (0.0192 * thrust, 0.012 * self.pose_pitch - if land >= 0.5 { 0.02 } else { 0.0 })
        };
        let drag = if body_idle || settling { FLY_DRAG * 0.62 } else { FLY_DRAG };
        self.pose_vx = self.pose_vx * drag + self.pose_yaw.cos() * forward;
        self.pose_vy = self.pose_vy * drag + self.pose_yaw.sin() * forward;
        self.pose_vz = self.pose_vz * drag + lift;
        let (vx, vy, vz, speed) = limit_velocity(self.pose_vx, self.pose_vy, self.pose_vz, MAX_FLY_SPEED);
        self.pose_vx = vx;
        self.pose_vy = vy;
        self.pose_vz = vz;
        self.pose_speed = speed;
        self.pose_x += self.pose_vx;
        self.pose_y += self.pose_vy;
        self.pose_z += self.pose_vz;
    }

    fn resolve_solids(&mut self) {
        for index in 0..self.walls.len() {
            let wall = self.walls[index];
            push_out(self, &wall);
        }
        let room = (self.room_min_x, self.room_max_x, self.room_min_y, self.room_max_y);
        let (x, y, z, vx, vy, vz) = contain(self.pose_x, self.pose_y, self.pose_z, self.pose_vx, self.pose_vy, self.pose_vz, room, BODY, 0.0);
        self.pose_x = x;
        self.pose_y = y;
        self.pose_z = z;
        self.pose_vx = vx;
        self.pose_vy = vy;
        self.pose_vz = vz;
        self.pose_speed = speed_of(vx, vy, vz);
    }

    fn try_eat(&mut self) {
        if self.eaten || self.foods.is_empty() {
            return;
        }
        self.foods.retain(|food| (food.x - self.pose_x).hypot(food.y - self.pose_y) > food.r + 0.08);
        if self.started_with_food && self.foods.is_empty() {
            self.eaten = true;
        }
    }

    fn write_layout(&mut self) {
        self.layout.fill(0);
        let mut cursor = 0;
        for value in [self.room_min_x, self.room_max_x, self.room_min_y, self.room_max_y] {
            write_f64(&mut self.layout, &mut cursor, value);
        }
        for value in self.start_pose {
            write_f64(&mut self.layout, &mut cursor, value);
        }
        write_u32(&mut self.layout, &mut cursor, self.start_foods.len() as u32);
        write_u32(&mut self.layout, &mut cursor, self.start_threats.len() as u32);
        write_u32(&mut self.layout, &mut cursor, self.start_landings.len() as u32);
        write_u32(&mut self.layout, &mut cursor, self.walls.len() as u32);
        for item in &self.start_foods {
            write_obj(&mut self.layout, &mut cursor, item);
        }
        cursor = 280;
        for item in &self.start_threats {
            write_obj(&mut self.layout, &mut cursor, item);
        }
        cursor = 408;
        for item in &self.start_landings {
            write_obj(&mut self.layout, &mut cursor, item);
        }
        cursor = 536;
        for wall in &self.walls {
            write_f64(&mut self.layout, &mut cursor, wall.min_x);
            write_f64(&mut self.layout, &mut cursor, wall.max_x);
            write_f64(&mut self.layout, &mut cursor, wall.min_y);
            write_f64(&mut self.layout, &mut cursor, wall.max_y);
        }
    }

    fn write_snap(&mut self, stage: Option<Stage>) {
        let stage = stage.unwrap_or_else(Stage::default);
        let rates = if self.ticks == 0 { [0.0; MOTOR_COUNT] } else { self.motor_rates() };
        self.snap.fill(0);
        let mut cursor = 0;
        write_u32(&mut self.snap, &mut cursor, self.ticks);
        write_u32(&mut self.snap, &mut cursor, self.cycles);
        let mut spike_ids = [0u16; N];
        let mut spike_count = 0u32;
        let mut driven_ids = [0u16; N];
        let mut driven_count = 0u32;
        for i in 0..N {
            if stage.spike[i] != 0 {
                spike_ids[spike_count as usize] = i as u16;
                spike_count += 1;
            }
            if stage.drive[i] != 0.0 {
                driven_ids[driven_count as usize] = i as u16;
                driven_count += 1;
            }
        }
        write_u32(&mut self.snap, &mut cursor, spike_count);
        write_u32(&mut self.snap, &mut cursor, driven_count);
        write_u32(&mut self.snap, &mut cursor, self.foods.len() as u32);
        write_u32(&mut self.snap, &mut cursor, self.threats.len() as u32);
        write_u32(&mut self.snap, &mut cursor, u32::from(self.eaten));
        let inside = u32::from(
            self.inside_xy(self.pose_x, self.pose_y) && self.pose_z >= FLOOR_Z - 1e-9 && self.pose_z <= CEILING_Z + 1e-9,
        );
        write_u32(&mut self.snap, &mut cursor, inside);
        for value in [self.pose_x, self.pose_y, self.pose_z, self.pose_yaw, self.pose_pitch, self.pose_speed] {
            write_f64(&mut self.snap, &mut cursor, value);
        }
        let escape = rates[5] as f64;
        let thrust = rates[0] as f64;
        let yaw = rates[1] as f64 - rates[2] as f64;
        let pitch = rates[3] as f64 - rates[4] as f64;
        let fleeing = escape >= 0.5 || self.escape_hold > 0;
        write_f64(&mut self.snap, &mut cursor, thrust);
        write_f64(&mut self.snap, &mut cursor, yaw);
        write_f64(&mut self.snap, &mut cursor, pitch);
        write_u32(&mut self.snap, &mut cursor, u32::from(rates[4] > 0.2));
        write_u32(&mut self.snap, &mut cursor, u32::from(fleeing));
        for value in rates {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        write_u32(&mut self.snap, &mut cursor, stage.nonzero);
        write_u32(&mut self.snap, &mut cursor, 0);
        for value in stage.held {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        for value in stage.decayed {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        for value in stage.drive {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        for value in stage.input {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        for value in stage.sum {
            write_f32(&mut self.snap, &mut cursor, value);
        }
        self.snap[cursor..cursor + N].copy_from_slice(&stage.spike);
        cursor += N;
        self.snap[cursor..cursor + N].copy_from_slice(&stage.refractory);
        cursor += N;
        for id in spike_ids {
            write_u16(&mut self.snap, &mut cursor, id);
        }
        for id in driven_ids {
            write_u16(&mut self.snap, &mut cursor, id);
        }
        let food_at = cursor;
        for item in self.foods.iter().take(MAX_FOODS) {
            write_obj(&mut self.snap, &mut cursor, item);
        }
        cursor = food_at + MAX_FOODS * 32;
        for item in self.threats.iter().take(MAX_THREATS) {
            write_obj(&mut self.snap, &mut cursor, item);
        }
        debug_assert!(cursor <= SNAP_LEN);
    }
}

#[derive(Clone)]
struct Stage {
    held: [f32; N],
    decayed: [f32; N],
    drive: [f32; N],
    input: [f32; N],
    sum: [f32; N],
    spike: [u8; N],
    refractory: [u8; N],
    nonzero: u32,
}

impl Default for Stage {
    fn default() -> Self {
        Self {
            held: [0.0; N],
            decayed: [0.0; N],
            drive: [0.0; N],
            input: [0.0; N],
            sum: [0.0; N],
            spike: [0; N],
            refractory: [0; N],
            nonzero: 0,
        }
    }
}

impl Clone for Obj {
    fn clone(&self) -> Self {
        *self
    }
}

impl Copy for Obj {}

fn nearest(items: &[Obj], x: f64, y: f64) -> Option<(&Obj, f64)> {
    let mut best: Option<(&Obj, f64)> = None;
    for item in items {
        let dist = (item.x - x).hypot(item.y - y);
        if best.map(|pair| dist < pair.1).unwrap_or(true) {
            best = Some((item, dist));
        }
    }
    best
}

fn angle_delta(target: f64, current: f64) -> f64 {
    let pi = std::f64::consts::PI;
    (target - current + pi).rem_euclid(2.0 * pi) - pi
}

fn ray_room(x: f64, y: f64, dx: f64, dy: f64, min_x: f64, max_x: f64, min_y: f64, max_y: f64) -> f64 {
    let mut ahead: f64 = 99.0;
    if dx.abs() > 1e-8 {
        for hit in [(min_x - x) / dx, (max_x - x) / dx] {
            if hit > 0.05 {
                ahead = ahead.min(hit);
            }
        }
    }
    if dy.abs() > 1e-8 {
        for hit in [(min_y - y) / dy, (max_y - y) / dy] {
            if hit > 0.05 {
                ahead = ahead.min(hit);
            }
        }
    }
    ahead
}

fn ray_box(x: f64, y: f64, dx: f64, dy: f64, wall: &Wall) -> Option<f64> {
    let mut tmin: f64 = 0.0;
    let mut tmax: f64 = 1e9;
    for (origin, direction, lower, upper) in [(x, dx, wall.min_x, wall.max_x), (y, dy, wall.min_y, wall.max_y)] {
        if direction.abs() < 1e-8 {
            if origin < lower || origin > upper {
                return None;
            }
            continue;
        }
        let inv = 1.0 / direction;
        let mut t1 = (lower - origin) * inv;
        let mut t2 = (upper - origin) * inv;
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        tmin = tmin.max(t1);
        tmax = tmax.min(t2);
        if tmin > tmax {
            return None;
        }
    }
    if tmin > 0.05 { Some(tmin) } else { None }
}

fn push_out(sim: &mut Sim, wall: &Wall) {
    let min_x = wall.min_x - BODY;
    let max_x = wall.max_x + BODY;
    let min_y = wall.min_y - BODY;
    let max_y = wall.max_y + BODY;
    if !(min_x < sim.pose_x && sim.pose_x < max_x && min_y < sim.pose_y && sim.pose_y < max_y) {
        return;
    }
    let left = sim.pose_x - min_x;
    let right = max_x - sim.pose_x;
    let bottom = sim.pose_y - min_y;
    let top = max_y - sim.pose_y;
    let nearest = fmin_first(fmin_first(left, right), fmin_first(bottom, top));
    if nearest == left {
        sim.pose_x = min_x;
        if sim.pose_vx > 0.0 {
            sim.pose_vx = 0.0;
        }
    } else if nearest == right {
        sim.pose_x = max_x;
        if sim.pose_vx < 0.0 {
            sim.pose_vx = 0.0;
        }
    } else if nearest == bottom {
        sim.pose_y = min_y;
        if sim.pose_vy > 0.0 {
            sim.pose_vy = 0.0;
        }
    } else {
        sim.pose_y = max_y;
        if sim.pose_vy < 0.0 {
            sim.pose_vy = 0.0;
        }
    }
}

fn speed_of(vx: f64, vy: f64, vz: f64) -> f64 {
    vx.hypot(vy).hypot(vz)
}

fn limit_velocity(vx: f64, vy: f64, vz: f64, limit: f64) -> (f64, f64, f64, f64) {
    let speed = speed_of(vx, vy, vz);
    if speed > limit && speed > 0.0 {
        let scale = limit / speed;
        (vx * scale, vy * scale, vz * scale, limit)
    } else {
        (vx, vy, vz, speed)
    }
}

fn contain(
    mut x: f64,
    mut y: f64,
    mut z: f64,
    mut vx: f64,
    mut vy: f64,
    mut vz: f64,
    room: (f64, f64, f64, f64),
    margin: f64,
    z_margin: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    let low_x = room.0 + margin;
    let high_x = room.1 - margin;
    let low_y = room.2 + margin;
    let high_y = room.3 - margin;
    let (low_z, high_z) = if CEILING_Z - z_margin < FLOOR_Z + z_margin {
        let mid = (FLOOR_Z + CEILING_Z) / 2.0;
        (mid, mid)
    } else {
        (FLOOR_Z + z_margin, CEILING_Z - z_margin)
    };
    if x < low_x {
        x = low_x;
        if vx < 0.0 {
            vx = 0.0;
        }
    } else if x > high_x {
        x = high_x;
        if vx > 0.0 {
            vx = 0.0;
        }
    }
    if y < low_y {
        y = low_y;
        if vy < 0.0 {
            vy = 0.0;
        }
    } else if y > high_y {
        y = high_y;
        if vy > 0.0 {
            vy = 0.0;
        }
    }
    if z < low_z {
        z = low_z;
        if vz < 0.0 {
            vz = 0.0;
        }
    } else if z > high_z {
        z = high_z;
        if vz > 0.0 {
            vz = 0.0;
        }
    }
    (x, y, z, vx, vy, vz)
}

fn nearest_volume(items: &[Obj], x: f64, y: f64, z: f64) -> Option<(&Obj, f64)> {
    let mut best: Option<(&Obj, f64)> = None;
    for item in items {
        let dist = speed_of(item.x - x, item.y - y, item.z - z);
        if best.map(|(_, best_dist)| dist < best_dist).unwrap_or(true) {
            best = Some((item, dist));
        }
    }
    best
}

fn fmin_first(a: f64, b: f64) -> f64 {
    if a <= b { a } else { b }
}

fn read_f64(bytes: &[u8], cursor: &mut usize) -> f64 {
    let value = f64::from_le_bytes(bytes[*cursor..*cursor + 8].try_into().unwrap());
    *cursor += 8;
    value
}

fn still_obj(x: f64, y: f64, z: f64, r: f64) -> Obj {
    Obj { x, y, z, r, vx: 0.0, vy: 0.0, vz: 0.0 }
}

fn read_obj(bytes: &[u8], cursor: &mut usize) -> Obj {
    still_obj(read_f64(bytes, cursor), read_f64(bytes, cursor), read_f64(bytes, cursor), read_f64(bytes, cursor))
}

fn write_u32(buf: &mut [u8], cursor: &mut usize, value: u32) {
    buf[*cursor..*cursor + 4].copy_from_slice(&value.to_le_bytes());
    *cursor += 4;
}

fn write_u16(buf: &mut [u8], cursor: &mut usize, value: u16) {
    buf[*cursor..*cursor + 2].copy_from_slice(&value.to_le_bytes());
    *cursor += 2;
}

fn write_f32(buf: &mut [u8], cursor: &mut usize, value: f32) {
    buf[*cursor..*cursor + 4].copy_from_slice(&value.to_le_bytes());
    *cursor += 4;
}

fn write_f64(buf: &mut [u8], cursor: &mut usize, value: f64) {
    buf[*cursor..*cursor + 8].copy_from_slice(&value.to_le_bytes());
    *cursor += 8;
}

fn write_obj(buf: &mut [u8], cursor: &mut usize, item: &Obj) {
    write_f64(buf, cursor, item.x);
    write_f64(buf, cursor, item.y);
    write_f64(buf, cursor, item.z);
    write_f64(buf, cursor, item.r);
}

static mut LAYOUT_IN: [u8; 2048] = [0; 2048];

#[no_mangle]
pub extern "C" fn snapshot_ptr() -> *const u8 {
    with_sim(|sim| sim.snap.as_ptr())
}

#[no_mangle]
pub extern "C" fn snapshot_len() -> u32 {
    SNAP_LEN as u32
}

#[no_mangle]
pub extern "C" fn layout_ptr() -> *const u8 {
    with_sim(|sim| sim.layout.as_ptr())
}

#[no_mangle]
pub extern "C" fn layout_len() -> u32 {
    LAYOUT_LEN as u32
}

#[no_mangle]
pub extern "C" fn layout_buffer() -> *mut u8 {
    unsafe { LAYOUT_IN.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn layout_buffer_cap() -> u32 {
    2048
}

#[no_mangle]
pub extern "C" fn reset(scenario: u32) -> i32 {
    with_sim(|sim| sim.apply_scenario(scenario));
    0
}

#[no_mangle]
pub extern "C" fn set_layout(len: u32) -> i32 {
    let len = len as usize;
    if len > 2048 {
        return 1;
    }
    let bytes = unsafe { &LAYOUT_IN[..len] }.to_vec();
    with_sim(|sim| sim.set_layout(&bytes))
}

#[no_mangle]
pub extern "C" fn set_hold(action: i32) {
    with_sim(|sim| sim.hold = action);
}

#[no_mangle]
pub extern "C" fn step() {
    with_sim(|sim| sim.step());
}
