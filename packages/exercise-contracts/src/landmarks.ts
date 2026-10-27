/**
 * Application-level landmark names mapped to MediaPipe Pose Landmarker indices (33-point model).
 * Blueprint §13: "a defined mapping between MediaPipe's landmark identifiers and our names".
 * Index source: MediaPipe Pose Landmarker model card. Do not reorder.
 */
export const MEDIAPIPE_POSE_INDEX = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
} as const;

export type LandmarkName = keyof typeof MEDIAPIPE_POSE_INDEX;

export const LANDMARK_NAMES = Object.keys(MEDIAPIPE_POSE_INDEX) as [
  LandmarkName,
  ...LandmarkName[],
];
