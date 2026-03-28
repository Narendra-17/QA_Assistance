import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import qaRouter from "./qa";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(qaRouter);

export default router;
