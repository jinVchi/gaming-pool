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
        [SerializeField] private Color lightSquareColor = new Color(0.9f, 0.9f, 0.8f);
        [SerializeField] private Color darkSquareColor = new Color(0.35f, 0.25f, 0.2f);
        [SerializeField] private Color selectedSquareColor = Color.yellow;

        // Unicode chess glyphs (♔♕♖♗♘♙ / ♚♛♜♝♞♟) — the only zero-asset option
        // available here. Whether the active font actually has these glyphs is
        // untested; flip this off in the Inspector to fall back to plain
        // letters (P/N/B/R/Q/K) if they render as blank boxes.
        [SerializeField] private bool useUnicodeGlyphs = true;

        private static readonly Dictionary<char, string> PieceGlyphs = new Dictionary<char, string>
        {
            ['K'] = "♔", ['Q'] = "♕", ['R'] = "♖", ['B'] = "♗", ['N'] = "♘", ['P'] = "♙",
            ['k'] = "♚", ['q'] = "♛", ['r'] = "♜", ['b'] = "♝", ['n'] = "♞", ['p'] = "♟",
        };

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
                var mesh = go.GetComponent<TextMesh>();
                mesh.text = useUnicodeGlyphs && PieceGlyphs.TryGetValue(kvp.Value, out var glyph)
                    ? glyph
                    : char.ToUpper(kvp.Value).ToString();
                mesh.color = char.IsUpper(kvp.Value) ? whitePieceColor : blackPieceColor;
            }
            foreach (var square in stale)
            {
                Destroy(_pieces[square]);
                _pieces.Remove(square);
            }
        }

        private GameObject CreatePieceLabel()
        {
            var go = new GameObject("piece");
            go.transform.SetParent(transform, false);
            var mesh = go.AddComponent<TextMesh>();
            mesh.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var pieceRenderer = go.GetComponent<MeshRenderer>();
            if (pieceRenderer != null) pieceRenderer.material = mesh.font.material;
            mesh.fontSize = 64;
            mesh.characterSize = 0.12f;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
            return go;
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
