using System;
using System.Collections.Generic;
using UnityEngine;

namespace GamingPool.Chess
{
    // Renders board state purely from server-sent FEN strings — never computes
    // legality itself. Click a piece, then a destination square; the server is
    // authoritative and will reject illegal moves via an "error" message.
    // Fixed orientation (White at the bottom) for both players, to keep the
    // camera setup simple and low-risk since this is written without a way to
    // test it in a real Editor.
    public class BoardRenderer : MonoBehaviour
    {
        [SerializeField] private Camera boardCamera;
        [SerializeField] private float cellSize = 1f;
        [SerializeField] private Color whitePieceColor = Color.white;
        [SerializeField] private Color blackPieceColor = Color.black;
        // Outline behind each letter so pieces stay readable on same-tone squares
        // (white letter on light square, black letter on dark square).
        [SerializeField] private Color whitePieceOutlineColor = new Color(0.1f, 0.1f, 0.1f);
        [SerializeField] private Color blackPieceOutlineColor = new Color(0.85f, 0.85f, 0.85f);
        [SerializeField] private Color lightSquareColor = new Color(0.9f, 0.9f, 0.8f);
        [SerializeField] private Color darkSquareColor = new Color(0.35f, 0.25f, 0.2f);
        [SerializeField] private Color selectedSquareColor = Color.yellow;

        public event Action<string, string, string> OnMoveAttempted; // from, to, promotion (may be null)

        private readonly Dictionary<string, GameObject> _squares = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, GameObject> _pieces = new Dictionary<string, GameObject>();
        private Dictionary<string, char> _boardState = new Dictionary<string, char>();
        private string _localColor = "w";
        private string _selectedSquare;

        private void Awake()
        {
            // Squares are created by the Editor setup script as children named
            // by algebraic notation ("a1".."h8"); index them here.
            foreach (Transform child in transform)
            {
                if (child.name.Length == 2) _squares[child.name] = child.gameObject;
            }
        }

        public void Initialize(string fen, string localColor)
        {
            _localColor = localColor;
            _selectedSquare = null;
            ApplyFen(fen);
        }

        public void ApplyMove(MovePayload move)
        {
            ApplyFen(move.Fen);
        }

        private void ApplyFen(string fen)
        {
            _boardState = ParsePiecePlacement(fen);

            var stale = new List<string>(_pieces.Keys);
            foreach (var kvp in _boardState)
            {
                stale.Remove(kvp.Key);
                if (!_pieces.TryGetValue(kvp.Key, out var go))
                {
                    go = CreatePieceLabel();
                    _pieces[kvp.Key] = go;
                }
                PositionAtSquare(go.transform, kvp.Key);
                var label = char.ToUpper(kvp.Value).ToString();
                var isWhite = char.IsUpper(kvp.Value);
                SetPieceText(
                    go,
                    label,
                    isWhite ? whitePieceColor : blackPieceColor,
                    isWhite ? whitePieceOutlineColor : blackPieceOutlineColor);
            }
            foreach (var square in stale)
            {
                Destroy(_pieces[square]);
                _pieces.Remove(square);
            }
        }

        // TextMesh has no outline support, so each piece is one main TextMesh
        // plus four copies offset diagonally behind it in the outline color —
        // reads as a contrast margin from the top-down camera.
        private const float OutlineOffset = 0.045f;

        private static readonly Vector2[] OutlineOffsets =
        {
            new Vector2(-OutlineOffset, -OutlineOffset),
            new Vector2(-OutlineOffset, OutlineOffset),
            new Vector2(OutlineOffset, -OutlineOffset),
            new Vector2(OutlineOffset, OutlineOffset),
        };

        private GameObject CreatePieceLabel()
        {
            var root = new GameObject("piece");
            root.transform.SetParent(transform, false);

            foreach (var offset in OutlineOffsets)
            {
                // Local +z faces away from the camera once the root is rotated
                // face-up, keeping outline copies rendered behind the main text.
                CreateTextMesh(root.transform, "outline", new Vector3(offset.x, offset.y, 0.01f));
            }
            CreateTextMesh(root.transform, "label", Vector3.zero);

            return root;
        }

        private static void CreateTextMesh(Transform parent, string name, Vector3 localPosition)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            var mesh = go.AddComponent<TextMesh>();
            mesh.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var meshRenderer = go.GetComponent<MeshRenderer>();
            if (meshRenderer != null) meshRenderer.material = mesh.font.material;
            mesh.fontSize = 64;
            mesh.characterSize = 0.12f;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
        }

        private static void SetPieceText(GameObject pieceRoot, string label, Color mainColor, Color outlineColor)
        {
            foreach (var mesh in pieceRoot.GetComponentsInChildren<TextMesh>())
            {
                mesh.text = label;
                mesh.color = mesh.gameObject.name == "label" ? mainColor : outlineColor;
            }
        }

        private void PositionAtSquare(Transform t, string square)
        {
            var (file, rank) = SquareToCoords(square);
            t.position = new Vector3(file * cellSize, 0.2f, rank * cellSize);
            t.rotation = Quaternion.Euler(90f, 0f, 0f);
        }

        private static (int file, int rank) SquareToCoords(string square)
        {
            var file = square[0] - 'a';
            var rank = square[1] - '1';
            return (file, rank);
        }

        private void Update()
        {
            if (!Input.GetMouseButtonDown(0) || boardCamera == null) return;

            var ray = boardCamera.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out var hit)) return;

            var square = hit.collider.gameObject.name;
            if (!_squares.ContainsKey(square)) return;

            HandleSquareClicked(square);
        }

        private void HandleSquareClicked(string square)
        {
            if (_selectedSquare == null)
            {
                if (_boardState.TryGetValue(square, out var piece) && IsLocalPiece(piece))
                {
                    _selectedSquare = square;
                    SetSquareColor(square, selectedSquareColor);
                }
                return;
            }

            if (_selectedSquare == square)
            {
                ResetSquareColor(square);
                _selectedSquare = null;
                return;
            }

            var from = _selectedSquare;
            ResetSquareColor(from);
            _selectedSquare = null;

            string promotion = null;
            if (_boardState.TryGetValue(from, out var movingPiece) &&
                char.ToLower(movingPiece) == 'p' &&
                (square[1] == '1' || square[1] == '8'))
            {
                promotion = "q";
            }

            OnMoveAttempted?.Invoke(from, square, promotion);
        }

        private bool IsLocalPiece(char piece)
        {
            var isWhitePiece = char.IsUpper(piece);
            return _localColor == "w" ? isWhitePiece : !isWhitePiece;
        }

        private void SetSquareColor(string square, Color color)
        {
            if (!_squares.TryGetValue(square, out var go)) return;
            var squareRenderer = go.GetComponent<Renderer>();
            if (squareRenderer != null) squareRenderer.material.color = color;
        }

        private void ResetSquareColor(string square)
        {
            var (file, rank) = SquareToCoords(square);
            var light = (file + rank) % 2 == 0;
            SetSquareColor(square, light ? lightSquareColor : darkSquareColor);
        }

        private static Dictionary<string, char> ParsePiecePlacement(string fen)
        {
            var placement = fen.Split(' ')[0];
            var ranks = placement.Split('/');
            var result = new Dictionary<string, char>();
            for (var rankIndex = 0; rankIndex < 8; rankIndex++)
            {
                var rankNumber = 8 - rankIndex; // ranks[0] is rank 8 per FEN spec
                var file = 0;
                foreach (var c in ranks[rankIndex])
                {
                    if (char.IsDigit(c))
                    {
                        file += c - '0';
                    }
                    else
                    {
                        var square = $"{(char)('a' + file)}{rankNumber}";
                        result[square] = c;
                        file += 1;
                    }
                }
            }
            return result;
        }
    }
}
