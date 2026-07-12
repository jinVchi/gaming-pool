using System.Collections.Generic;
using UnityEngine;

namespace GamingPool.Snake
{
    public class SnakeRenderer : MonoBehaviour
    {
        [SerializeField] private GameObject segmentPrefab;
        [SerializeField] private float cellSize = 1f;
        [SerializeField] private Color fallbackColor = Color.white;

        private readonly Dictionary<string, List<GameObject>> _pools = new Dictionary<string, List<GameObject>>();

        public void Render(List<SnakeView> snakes)
        {
            var seen = new HashSet<string>();

            foreach (var snake in snakes)
            {
                if (!snake.Alive) continue;
                seen.Add(snake.Id);

                if (!_pools.TryGetValue(snake.Id, out var pool))
                {
                    pool = new List<GameObject>();
                    _pools[snake.Id] = pool;
                }

                if (!ColorUtility.TryParseHtmlString(snake.Color, out var color))
                {
                    color = fallbackColor;
                }

                for (var i = 0; i < snake.Segments.Count; i++)
                {
                    GameObject segment;
                    if (i < pool.Count)
                    {
                        segment = pool[i];
                        segment.SetActive(true);
                    }
                    else
                    {
                        segment = Instantiate(segmentPrefab, transform);
                        pool.Add(segment);
                    }

                    var cell = snake.Segments[i];
                    segment.transform.position = new Vector3(cell.X * cellSize, 0f, -cell.Y * cellSize);
                    var segmentRenderer = segment.GetComponent<Renderer>();
                    if (segmentRenderer != null) segmentRenderer.material.color = color;
                }

                for (var i = snake.Segments.Count; i < pool.Count; i++)
                {
                    pool[i].SetActive(false);
                }
            }

            var stale = new List<string>();
            foreach (var kvp in _pools)
            {
                if (seen.Contains(kvp.Key)) continue;
                foreach (var go in kvp.Value) Destroy(go);
                stale.Add(kvp.Key);
            }
            foreach (var id in stale) _pools.Remove(id);
        }
    }
}
