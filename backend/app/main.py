import io
import os
from typing import List, Optional

import chess
import chess.engine
import chess.pgn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Chess Out API")

cors_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in cors_origins if origin.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


class PgnRequest(BaseModel):
    pgn: str = Field(..., min_length=1)


class PgnResponse(BaseModel):
    start_fen: str
    fens: List[str]
    moves: List[str]
    result: Optional[str]
    outcome: Optional[str]
    outcome_reason: Optional[str]
    outcome_details: Optional[str]


class BestMoveRequest(BaseModel):
    fen: str
    depth: int = Field(12, ge=1, le=30)


class BestMoveResponse(BaseModel):
    uci: str
    san: str


class AnalyzeRequest(BaseModel):
    fen: str
    depth: int = Field(12, ge=1, le=30)
    multipv: int = Field(5, ge=1, le=10)


class AnalysisLine(BaseModel):
    uci: str
    san: str
    score: str


class AnalyzeResponse(BaseModel):
    score: str
    lines: List[AnalysisLine]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/parse_pgn", response_model=PgnResponse)
def parse_pgn(payload: PgnRequest):
    try:
        game = chess.pgn.read_game(io.StringIO(payload.pgn))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid PGN: {exc}")

    if game is None:
        raise HTTPException(status_code=400, detail="No game found in PGN")

    board = game.board()
    fens: List[str] = [board.fen()]
    moves: List[str] = []
    for move in game.mainline_moves():
        moves.append(board.san(move))
        board.push(move)
        fens.append(board.fen())

    outcome = None
    outcome_reason = None
    outcome_details = None
    if game.headers.get("Result") and game.headers.get("Result") != "*":
        result = game.headers.get("Result")
        if result == "1-0":
            outcome = "White wins"
        elif result == "0-1":
            outcome = "Black wins"
        elif result == "1/2-1/2":
            outcome = "Draw"

        if board.is_checkmate():
            outcome_reason = "Checkmate"
            outcome_details = "The side to move has no legal moves and is in check."
        elif board.is_stalemate():
            outcome_reason = "Stalemate"
            outcome_details = "The side to move has no legal moves and is not in check."
        elif board.is_insufficient_material():
            outcome_reason = "Insufficient material"
            outcome_details = "Neither side has enough material to force mate."
        elif board.is_seventyfive_moves():
            outcome_reason = "Seventy-five move rule"
            outcome_details = "No pawn moves or captures in the last 75 moves."
        elif board.is_fivefold_repetition():
            outcome_reason = "Fivefold repetition"
            outcome_details = "The same position occurred five times."
        elif board.can_claim_threefold_repetition():
            outcome_reason = "Threefold repetition (claimable)"
            outcome_details = "The same position occurred three times; a draw can be claimed."
        elif board.can_claim_fifty_moves():
            outcome_reason = "Fifty-move rule (claimable)"
            outcome_details = "No pawn moves or captures in the last 50 moves; a draw can be claimed."
        elif outcome == "Draw":
            outcome_reason = "Draw"
            outcome_details = "Result recorded as a draw in the PGN."

    return PgnResponse(
        start_fen=chess.STARTING_FEN,
        fens=fens,
        moves=moves,
        result=game.headers.get("Result"),
        outcome=outcome,
        outcome_reason=outcome_reason,
        outcome_details=outcome_details,
    )


@app.post("/api/best_move", response_model=BestMoveResponse)
def best_move(payload: BestMoveRequest):
    try:
        board = chess.Board(payload.fen)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {exc}")

    stockfish_path = os.getenv("STOCKFISH_PATH", "stockfish")
    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            result = engine.play(board, chess.engine.Limit(depth=payload.depth))
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Stockfish binary not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stockfish error: {exc}")

    uci_move = result.move.uci()
    san_move = board.san(result.move)
    return BestMoveResponse(uci=uci_move, san=san_move)


def format_score(score: chess.engine.PovScore) -> str:
    if score.is_mate():
        mate_in = score.mate()
        if mate_in is None:
            return "Mate"
        return f"Mate in {abs(mate_in)}"
    cp = score.score()
    if cp is None:
        return "0.00"
    return f"{cp / 100:.2f}"


@app.post("/api/analyze_fen", response_model=AnalyzeResponse)
def analyze_fen(payload: AnalyzeRequest):
    try:
        board = chess.Board(payload.fen)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {exc}")

    stockfish_path = os.getenv("STOCKFISH_PATH", "stockfish")
    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            info_list = engine.analyse(
                board,
                chess.engine.Limit(depth=payload.depth),
                multipv=payload.multipv,
            )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Stockfish binary not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stockfish error: {exc}")

    if not isinstance(info_list, list):
        info_list = [info_list]

    lines: List[AnalysisLine] = []
    for info in info_list:
        move = info.get("pv", [None])[0]
        if move is None:
            continue
        san = board.san(move)
        score = info.get("score")
        score_text = "0.00"
        if score is not None:
            score_text = format_score(score.pov(board.turn))
        lines.append(AnalysisLine(uci=move.uci(), san=san, score=score_text))

    overall_score = "0.00"
    if lines:
        overall_score = lines[0].score
    return AnalyzeResponse(score=overall_score, lines=lines)
