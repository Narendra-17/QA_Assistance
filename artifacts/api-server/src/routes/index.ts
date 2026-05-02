import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import qaRouter from "./qa";
import keysRouter from "./keys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/qa", qaRouter);
router.use(keysRouter);

export default router;
