import { useCallback, useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";

const emptyFens = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
];

export default function App() {
  const [pgnText, setPgnText] = useState("");
  const [fens, setFens] = useState(emptyFens);
  const [moves, setMoves] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [bestMove, setBestMove] = useState("");
  const [outcome, setOutcome] = useState("");
  const [analysisByIndex, setAnalysisByIndex] = useState({});
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [hoverArrow, setHoverArrow] = useState(null);
  const [loading, setLoading] = useState(false);

  const currentFen = useMemo(() => fens[index] || emptyFens[0], [fens, index]);
  const currentMove = index > 0 ? moves[index - 1] : "Start";
  const currentAnalysis = analysisByIndex[index];

  const buildMovetext = useCallback((sanMoves) => {
    const parts = [];
    for (let i = 0; i < sanMoves.length; i += 2) {
      const moveNo = Math.floor(i / 2) + 1;
      const white = sanMoves[i];
      const black = sanMoves[i + 1];
      if (black) {
        parts.push(`${moveNo}. ${white} ${black}`);
      } else {
        parts.push(`${moveNo}. ${white}`);
      }
    }
    return parts.join(" ");
  }, []);

  const applyMoveAtIndex = useCallback(
    (move, chess) => {
      if (!move) return;
      const newMoves = moves.slice(0, index);
      newMoves.push(move.san);
      const nextFen = chess.fen();
      const newFens = fens.slice(0, index + 1);
      newFens.push(nextFen);
      setMoves(newMoves);
      setFens(newFens);
      setIndex(newMoves.length);
      setPgnText(buildMovetext(newMoves));
      setAnalysisByIndex({});
      setAnalysisError("");
    },
    [moves, index, fens, buildMovetext]
  );

  const parsePgn = useCallback(async () => {
    if (!pgnText.trim()) {
      setStatus("Paste a PGN to begin.");
      setFens(emptyFens);
      setMoves([]);
      setIndex(0);
      return;
    }

    setLoading(true);
    setStatus("Parsing PGN...");
    setBestMove("");
    setOutcome("");
    setAnalysisByIndex({});
    setAnalysisError("");

    try {
      const response = await fetch("/api/parse_pgn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn: pgnText })
      });

      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail?.detail || "Unable to parse PGN");
      }

      const data = await response.json();
      setFens(data.fens || emptyFens);
      setMoves(data.moves || []);
      setIndex(0);
      setStatus(`Loaded ${data.moves?.length || 0} moves.`);
      if (data.outcome_reason) {
        const detail = data.outcome_details ? ` — ${data.outcome_details}` : "";
        setOutcome(`${data.outcome}${data.outcome ? ": " : ""}${data.outcome_reason}${detail}`);
      } else if (data.outcome) {
        setOutcome(data.outcome);
      }
    } catch (error) {
      setStatus(error.message);
      setFens(emptyFens);
      setMoves([]);
      setIndex(0);
      setOutcome("");
      setAnalysisByIndex({});
      setAnalysisError("");
    } finally {
      setLoading(false);
    }
  }, [pgnText]);

  useEffect(() => {
    let isMounted = true;
    const fetchAnalysis = async () => {
      if (!fens.length) return;
      if (analysisByIndex[index]) return;

      setAnalysisLoading(true);
      setAnalysisError("");
      try {
        const response = await fetch("/api/analyze_fen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: currentFen, depth: 12, multipv: 5 })
        });

        if (!response.ok) {
          const detail = await response.json();
          throw new Error(detail?.detail || "Unable to analyze position");
        }

        const data = await response.json();
        if (!isMounted) return;
        setAnalysisByIndex((prev) => ({
          ...prev,
          [index]: data
        }));
      } catch (error) {
        if (!isMounted) return;
        setAnalysisError(error.message);
      } finally {
        if (isMounted) {
          setAnalysisLoading(false);
        }
      }
    };

    fetchAnalysis();
    return () => {
      isMounted = false;
    };
  }, [currentFen, fens.length, index, analysisByIndex]);

  const handlePieceDrop = useCallback(
    (sourceSquare, targetSquare) => {
      const chess = new Chess(currentFen);
      const move = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q"
      });
      if (!move) {
        return false;
      }
      applyMoveAtIndex(move, chess);
      return true;
    },
    [currentFen, applyMoveAtIndex]
  );

  const handleRecommendationClick = useCallback(
    (uci) => {
      if (!uci) return;
      const chess = new Chess(currentFen);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined
      });
      if (!move) return;
      applyMoveAtIndex(move, chess);
    },
    [currentFen, applyMoveAtIndex]
  );

  const requestBestMove = useCallback(async () => {
    setBestMove("");
    setLoading(true);
    try {
      const response = await fetch("/api/best_move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: currentFen, depth: 12 })
      });

      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail?.detail || "Unable to analyze position");
      }

      const data = await response.json();
      setBestMove(`Stockfish suggests: ${data.san} (${data.uci})`);
    } catch (error) {
      setBestMove(error.message);
    } finally {
      setLoading(false);
    }
  }, [currentFen]);

  const stepForward = () => setIndex((value) => Math.min(value + 1, fens.length - 1));
  const stepBack = () => setIndex((value) => Math.max(value - 1, 0));

  const handlePaste = () => {
    setTimeout(() => {
      parsePgn();
    }, 0);
  };

  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      parsePgn();
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Chess Out</p>
          <h1>PGN Note Explorer</h1>
          <p className="subhead">
            Paste PGN notes, then step through moves while the board keeps pace.
          </p>
        </div>
        <div className="status-card">
          <p className="status-label">Status</p>
          <p className="status-text">{status || "Waiting for PGN."}</p>
          {bestMove && <p className="status-text">{bestMove}</p>}
          {outcome && <p className="status-text">{outcome}</p>}
        </div>
      </header>

      <main className="layout">
        <section className="board-panel">
          <div className="board-shell">
            <Chessboard
              position={currentFen}
              onPieceDrop={handlePieceDrop}
              customArrows={hoverArrow ? [hoverArrow] : []}
            />
          </div>
          <div className="move-indicator">
            <span>Move {index}</span>
            <strong>{currentMove}</strong>
          </div>
        </section>

        <section className="editor-panel">
          <label className="editor-label" htmlFor="pgn-input">
            PGN Notes
          </label>
          <textarea
            id="pgn-input"
            placeholder="Paste PGN here..."
            value={pgnText}
            onChange={(event) => setPgnText(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={12}
          />
          <div className="editor-actions">
            <button className="primary" onClick={parsePgn} disabled={loading}>
              Parse PGN
            </button>
            <button className="secondary" onClick={requestBestMove} disabled={loading}>
              Best Move
            </button>
          </div>
          <div className="stepper">
            <button onClick={stepBack} disabled={index === 0}>
              ◀ Back
            </button>
            <button onClick={stepForward} disabled={index >= fens.length - 1}>
              Forward ▶
            </button>
          </div>
          <div className="analysis-card">
            <p className="analysis-title">Stockfish (side to move)</p>
            {analysisLoading && <p className="analysis-muted">Analyzing...</p>}
            {!analysisLoading && analysisError && (
              <p className="analysis-muted">{analysisError}</p>
            )}
            {!analysisLoading && currentAnalysis && (
              <>
                <p className="analysis-score">Evaluation: {currentAnalysis.score}</p>
                <ol className="analysis-list">
                  {currentAnalysis.lines?.map((line) => (
                    <li
                      key={line.uci}
                      onMouseEnter={() =>
                        setHoverArrow([line.uci.slice(0, 2), line.uci.slice(2, 4)])
                      }
                      onMouseLeave={() => setHoverArrow(null)}
                    >
                      <button
                        className="analysis-move"
                        type="button"
                        onClick={() => handleRecommendationClick(line.uci)}
                      >
                        {line.san}
                      </button>
                      <span className="analysis-scoreline">{line.score}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          <p className="hint">
            Tip: paste PGN and use the arrow buttons to walk through each move.
          </p>
        </section>
      </main>
    </div>
  );
}
