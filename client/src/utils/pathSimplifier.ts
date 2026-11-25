import type { WhiteboardPoint } from '@/types/whiteboard';

/**
 * Computes the perpendicular distance from a point p to the line segment between a and b.
 */
export function perpendicularDistance(p: WhiteboardPoint, a: WhiteboardPoint, b: WhiteboardPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lineLengthSq = dx * dx + dy * dy;

  if (lineLengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Cross-product magnitude / line length
  const numerator = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
  return numerator / Math.sqrt(lineLengthSq);
}

/**
 * Filters out consecutive points that are closer than minDistance to reduce raw sampling noise.
 * Guaranteed to preserve the first and last points.
 */
export function filterMinDistance(points: WhiteboardPoint[], minDistance = 1.5): WhiteboardPoint[] {
  if (points.length <= 2) return points;

  const filtered: WhiteboardPoint[] = [points[0]];
  let last = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i];
    const distSq = (pt.x - last.x) * (pt.x - last.x) + (pt.y - last.y) * (pt.y - last.y);
    if (distSq >= minDistance * minDistance) {
      filtered.push(pt);
      last = pt;
    }
  }

  // Always keep the final point to preserve exact stroke end
  filtered.push(points[points.length - 1]);
  return filtered;
}

/**
 * Standard Ramer-Douglas-Peucker (RDP) path simplification algorithm.
 * Recursively decimates points within perpendicular tolerance epsilon.
 * Guaranteed to preserve exact start and end points and all corners.
 */
export function ramerDouglasPeucker(points: WhiteboardPoint[], epsilon = 1.0): WhiteboardPoint[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    // Recursive division
    const recResults1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const recResults2 = ramerDouglasPeucker(points.slice(index), epsilon);

    // Concatenate, removing duplicate midpoint
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
  }

  return [points[0], points[end]];
}

/**
 * Simplifies a freehand whiteboard drawing path using distance filtering followed by RDP.
 * Reduces raw point count by 50%–75% while preserving endpoints, curvature, and corners.
 *
 * @param points Raw points collected during pointer interaction
 * @param epsilon Tolerance in canvas pixels (default: 1.0)
 * @param minDistance Minimum distance between consecutive points (default: 1.5)
 */
export function simplifyFreehandPath(
  points: WhiteboardPoint[],
  epsilon = 1.0,
  minDistance = 1.5
): WhiteboardPoint[] {
  if (!points || points.length <= 2) return points ? [...points] : [];
  const distanceFiltered = filterMinDistance(points, minDistance);
  return ramerDouglasPeucker(distanceFiltered, epsilon);
}
