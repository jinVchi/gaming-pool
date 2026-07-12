using System.Collections.Generic;
using UnityEngine;

namespace GamingPool.Snake
{
    public class FoodRenderer : MonoBehaviour
    {
        [SerializeField] private GameObject foodPrefab;
        [SerializeField] private float cellSize = 1f;

        private readonly List<GameObject> _pool = new List<GameObject>();

        public void Render(List<Cell> food)
        {
            for (var i = 0; i < food.Count; i++)
            {
                GameObject item;
                if (i < _pool.Count)
                {
                    item = _pool[i];
                    item.SetActive(true);
                }
                else
                {
                    item = Instantiate(foodPrefab, transform);
                    _pool.Add(item);
                }
                item.transform.position = new Vector3(food[i].X * cellSize, 0f, -food[i].Y * cellSize);
            }

            for (var i = food.Count; i < _pool.Count; i++)
            {
                _pool[i].SetActive(false);
            }
        }
    }
}
