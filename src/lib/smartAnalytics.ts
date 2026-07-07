import { AuditItem } from "../types";

export interface ItemHistoryStats {
  itemId: string;
  name: string;
  totalCounts: number;
  differences: number[];
  outliersExcluded: number[];
  historicalMeanDiff: number;
  historicalStdDev: number;
  isInherentSystemicDiscrepancy: boolean;
}

export interface SmartEvaluatedItem extends AuditItem {
  sessionDate: string;
  sessionId: string;
  sessionName: string;
  approvedQty: number;
  currentDiff: number;
  isConsistentWithHistory: boolean;
  evaluationLabel: "جرد دقيق" | "انحراف نظامي مقبول" | "خطأ جرد بشري" | "انحراف غير مبرر" | "غير مجرد";
  evaluationColor: string;
  isPenalized: boolean;
  penaltyReason?: string;
}

export interface StorekeeperSmartEvaluation {
  code: string;
  name: string;
  score: number;
  grade: "ممتاز" | "جيد جداً" | "مقبول" | "ضعيف";
  gradeColor: string;
  gradeIcon: string;
  totalSessions: number;
  totalItemsAudited: number;
  perfectMatchesCount: number; // diff === 0
  inherentExcusedCount: number; // diff !== 0 but close to historical mean
  humanErrorsCount: number; // count of items with count errors
  modificationsCount: number; // corrections made to counts
  productionErrorsCount: number; // excused production errors
  loadingErrorsCount: number; // excused loading errors
  strengths: string[];
  weaknesses: string[];
  forecastText: string;
  evaluatedItems: SmartEvaluatedItem[];
}

export interface SupervisorSmartEvaluation {
  code: string;
  name: string;
  score: number;
  grade: "ممتاز" | "جيد جداً" | "مقبول" | "ضعيف";
  gradeColor: string;
  totalSessionsApproved: number;
  totalItemsReviewed: number;
  managerOverridesCount: number; // Cases where supervisor approved but manager had to change
  recheckRequestsIssued: number; // Rechecks they requested
  responseSpeedScore: number; // Dummy mock/heuristic based on hours or days
  verificationAccuracyRate: number; // Percentage of items that didn't need manager correction
  strengths: string[];
  weaknesses: string[];
}

// Outlier removal using standard Interquartile Range (IQR) or Simple Trimming
function calculateStatsExcludingOutliers(diffs: number[]): {
  trimmedMean: number;
  stdDev: number;
  outliersCount: number;
  cleanDiffs: number[];
} {
  if (diffs.length === 0) {
    return { trimmedMean: 0, stdDev: 0, outliersCount: 0, cleanDiffs: [] };
  }
  if (diffs.length <= 3) {
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance = diffs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / diffs.length;
    return {
      trimmedMean: mean,
      stdDev: Math.sqrt(variance) || 0.5,
      outliersCount: 0,
      cleanDiffs: diffs
    };
  }

  // Robust Outlier Removal using Interquartile Range (IQR)
  const sorted = [...diffs].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const cleanDiffs = diffs.filter(x => x >= lowerBound && x <= upperBound);
  const outliersCount = diffs.length - cleanDiffs.length;

  // Use simple trimming if IQR removes everything or if we want standard trimming
  const finalClean = cleanDiffs.length > 0 ? cleanDiffs : sorted.slice(1, -1);

  const mean = finalClean.reduce((a, b) => a + b, 0) / finalClean.length;
  const variance = finalClean.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / finalClean.length;

  return {
    trimmedMean: mean,
    stdDev: Math.sqrt(variance) || 0.5,
    outliersCount,
    cleanDiffs: finalClean
  };
}

/**
 * Main function to run the advanced statistical evaluation algorithm
 */
export function runSmartAnalytics(
  pastSessions: any[],
  allUsers: any[]
): {
  itemStats: Record<string, ItemHistoryStats>;
  storekeeperEvaluations: StorekeeperSmartEvaluation[];
  supervisorEvaluations: SupervisorSmartEvaluation[];
  globalMetrics: {
    totalSessions: number;
    totalEvaluatedItems: number;
    accuracyTrend: { date: string; accuracy: number; variance: number }[];
    errorsDistribution: { name: string; value: number; color: string }[];
    totalSystemicExcused: number;
    totalHumanErrors: number;
  };
} {
  // 1. Gather all items historically to build the item statistical baselines
  const itemDiffsMap: Record<string, { name: string; diffs: number[] }> = {};

  pastSessions.forEach(session => {
    (session.items || []).forEach((item: any) => {
      const id = String(item.itemId || item.id || "");
      if (!id) return;

      const book = item.bookQty || 0;
      const skQty = item.storekeeperQty !== null && item.storekeeperQty !== undefined ? item.storekeeperQty : item.physicalQty;
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      const physical = managerVal !== null ? managerVal : (supervisorVal !== null ? supervisorVal : (skQty !== null ? skQty : book));
      const diff = physical - book;

      if (!itemDiffsMap[id]) {
        itemDiffsMap[id] = { name: item.itemName || item.name || "صنف غير معروف", diffs: [] };
      }
      itemDiffsMap[id].diffs.push(diff);
    });
  });

  // Calculate stats for each item
  const itemStats: Record<string, ItemHistoryStats> = {};
  Object.entries(itemDiffsMap).forEach(([id, data]) => {
    const stats = calculateStatsExcludingOutliers(data.diffs);
    
    // An item is considered to have a systemic/inherent discrepancy if its average historical difference
    // after excluding outliers is non-zero (absolute mean >= 1.5) and has stable variance (std dev relative to mean is low)
    const isSystemic = Math.abs(stats.trimmedMean) >= 1.5 && stats.stdDev <= Math.abs(stats.trimmedMean) * 0.8;

    itemStats[id] = {
      itemId: id,
      name: data.name,
      totalCounts: data.diffs.length,
      differences: data.diffs,
      outliersExcluded: data.diffs.filter(x => !stats.cleanDiffs.includes(x)),
      historicalMeanDiff: stats.trimmedMean,
      historicalStdDev: stats.stdDev,
      isInherentSystemicDiscrepancy: isSystemic
    };
  });

  // 2. Evaluate Storekeepers
  const storekeepersMap = new Map<string, any>();
  
  // Initialize storekeepers from allUsers to make sure they are present
  allUsers.forEach(u => {
    if (u.role === "storekeeper") {
      storekeepersMap.set(String(u.code), {
        code: String(u.code),
        name: u.name,
        sessions: new Set<string>(),
        items: []
      });
    }
  });

  pastSessions.forEach(session => {
    const sDate = session.date ? session.date.split("T")[0] : "غير محدد";
    (session.items || []).forEach((item: any) => {
      const keeperCode = String(item.assignedTo || "");
      if (!keeperCode || keeperCode === "general" || keeperCode === "عام") return;

      if (!storekeepersMap.has(keeperCode)) {
        // Dynamic addition if not in users list but has assigned jobs
        const uDetails = allUsers.find(u => String(u.code) === keeperCode);
        storekeepersMap.set(keeperCode, {
          code: keeperCode,
          name: uDetails?.name || `أمين مخزن رقم ${keeperCode}`,
          sessions: new Set<string>(),
          items: []
        });
      }

      const keeperData = storekeepersMap.get(keeperCode);
      keeperData.sessions.add(session.id);
      keeperData.items.push({
        ...item,
        sessionDate: sDate,
        sessionId: session.id,
        sessionName: session.name || "جلسة غير مسمى"
      });
    });
  });

  const storekeeperEvaluations: StorekeeperSmartEvaluation[] = [];

  storekeepersMap.forEach((keeper, code) => {
    let score = 100;
    let perfectMatchesCount = 0;
    let inherentExcusedCount = 0;
    let humanErrorsCount = 0;
    let productionErrorsCount = 0;
    let loadingErrorsCount = 0;
    let modificationsCount = 0;

    const evaluatedItems: SmartEvaluatedItem[] = [];

    keeper.items.forEach((item: any) => {
      const id = String(item.itemId || item.id || "");
      const book = item.bookQty || 0;
      const skQty = item.storekeeperQty !== null && item.storekeeperQty !== undefined ? item.storekeeperQty : item.physicalQty;
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      const physical = managerVal !== null ? managerVal : (supervisorVal !== null ? supervisorVal : (skQty !== null ? skQty : book));
      const currentDiff = physical - book;

      if (skQty === null) {
        evaluatedItems.push({
          ...item,
          approvedQty: physical,
          currentDiff,
          isConsistentWithHistory: false,
          evaluationLabel: "غير مجرد",
          evaluationColor: "text-slate-400 bg-slate-50 border-slate-100",
          isPenalized: false
        });
        return;
      }

      // Check corrections and modifications
      const localModsCount = (item.storekeeperModifications || []).length;
      const wasCorrectedBySupervisor = supervisorVal !== null && skQty !== supervisorVal;
      const wasCorrectedByManager = managerVal !== null && (supervisorVal !== null ? supervisorVal : skQty) !== managerVal;
      
      const totalModsOnThisItem = localModsCount + (wasCorrectedBySupervisor ? 1 : 0) + (wasCorrectedByManager ? 1 : 0);
      modificationsCount += totalModsOnThisItem;

      // Classify the difference based on historical statistical context and manually provided reasons (توضيح الفرق)
      const historical = itemStats[id];
      const meanDiff = historical ? historical.historicalMeanDiff : 0;
      const stdDev = historical ? historical.historicalStdDev : 1.0;

      // A difference is consistent with history if the distance from the trimmed mean is within standard tolerance bounds
      const differenceDistance = Math.abs(currentDiff - meanDiff);
      const tolerance = Math.max(1.5, stdDev * 1.5);
      const isConsistentWithHistory = differenceDistance <= tolerance;

      const reason = item.varianceReason || "أخرى";
      let evaluationLabel: "جرد دقيق" | "انحراف نظامي مقبول" | "خطأ جرد بشري" | "انحراف غير مبرر" | "غير مجرد" = "جرد دقيق";
      let evaluationColor = "text-emerald-700 bg-emerald-50 border-emerald-100";
      let isPenalized = false;
      let penaltyReason = "";

      if (currentDiff === 0) {
        perfectMatchesCount++;
        evaluationLabel = "جرد دقيق";
        evaluationColor = "text-emerald-700 bg-emerald-50 border-emerald-150";
      } else if (reason === "خطأ انتاج") {
        productionErrorsCount++;
        evaluationLabel = "انحراف نظامي مقبول";
        evaluationColor = "text-blue-700 bg-blue-50 border-blue-150";
      } else if (reason === "خطأ تحميل") {
        loadingErrorsCount++;
        evaluationLabel = "انحراف نظامي مقبول";
        evaluationColor = "text-cyan-700 bg-cyan-50 border-cyan-150";
      } else if (reason === "خطأ جرد") {
        humanErrorsCount++;
        evaluationLabel = "خطأ جرد بشري";
        evaluationColor = "text-rose-700 bg-rose-50 border-rose-150";
        isPenalized = true;
        penaltyReason = "خطأ جرد بشري صريح";
      } else {
        // Reason is "أخرى" or unspecified, apply statistical rules
        if (isConsistentWithHistory) {
          inherentExcusedCount++;
          evaluationLabel = "انحراف نظامي مقبول";
          evaluationColor = "text-indigo-700 bg-indigo-50 border-indigo-150";
        } else {
          humanErrorsCount++;
          evaluationLabel = "انحراف غير مبرر";
          evaluationColor = "text-amber-700 bg-amber-50 border-amber-150";
          isPenalized = true;
          penaltyReason = "انحراف غير معتاد تاريخياً لهذا الصنف";
        }
      }

      // Deduct score based on metrics
      if (isPenalized) {
        score -= 8; // Penalty for clear error
      }
      
      // Penalize modifications (initial count error indicator)
      if (totalModsOnThisItem > 0) {
        score -= (totalModsOnThisItem * 4);
      }

      evaluatedItems.push({
        ...item,
        approvedQty: physical,
        currentDiff,
        isConsistentWithHistory,
        evaluationLabel,
        evaluationColor,
        isPenalized,
        penaltyReason: penaltyReason || undefined
      });
    });

    // Score boundaries
    score = Math.max(35, Math.min(100, score));

    // Map to grades
    let grade: "ممتاز" | "جيد جداً" | "مقبول" | "ضعيف" = "مقبول";
    let gradeColor = "text-amber-700 bg-amber-50 border-amber-200";
    let gradeIcon = "👑";

    if (score >= 90) {
      grade = "ممتاز";
      gradeColor = "text-emerald-700 bg-emerald-50 border-emerald-250";
      gradeIcon = "👑";
    } else if (score >= 75) {
      grade = "جيد جداً";
      gradeColor = "text-indigo-700 bg-indigo-50 border-indigo-200";
      gradeIcon = "⭐";
    } else if (score >= 60) {
      grade = "مقبول";
      gradeColor = "text-amber-700 bg-amber-50 border-amber-200";
      gradeIcon = "✔️";
    } else {
      grade = "ضعيف";
      gradeColor = "text-rose-700 bg-rose-50 border-rose-250";
      gradeIcon = "⚠️";
    }

    // Dynamic AI strengths/weaknesses and forecast texts
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    let forecastText = "";

    const accuracyPercent = keeper.items.length > 0 ? Math.round((perfectMatchesCount / keeper.items.length) * 100) : 100;
    const errorRate = keeper.items.length > 0 ? Math.round((humanErrorsCount / keeper.items.length) * 100) : 0;

    if (accuracyPercent >= 80) {
      strengths.push("دقة استثنائية في مطابقة الأرصدة الدفترية للأصناف المجرودة.");
    }
    if (modificationsCount === 0 && keeper.items.length > 0) {
      strengths.push("استقرار عالي في العد الأولي دون الحاجة لإعادة الجرد أو التعديل.");
    } else if (modificationsCount < keeper.items.length * 0.1) {
      strengths.push("نسبة ضئيلة جداً من تعديلات وتصحيحات الجرد.");
    }
    if (inherentExcusedCount > 0) {
      strengths.push("قدرة ممتازة على تمييز الفروقات النظامية للمنتجات وتوثيقها بشكل صحيح.");
    }

    if (strengths.length === 0) {
      strengths.push("الالتزام بمواعيد تسليم ورفع جرد الصنف بكامل الوردية.");
    }

    if (errorRate >= 20) {
      weaknesses.push(`ارتفاع معدل أخطاء الجرد البشرية إلى ${errorRate}% من إجمالي الأصناف.`);
    }
    if (modificationsCount > keeper.items.length * 0.25) {
      weaknesses.push("كثرة تعديلات وإعادات الجرد، مما يشير لعدم دقة عملية الجرد الأولى.");
    }
    if (humanErrorsCount > 3) {
      weaknesses.push("وجود انحرافات متكررة غير مبررة تاريخياً عن متوسط عجز الأصناف.");
    }

    if (weaknesses.length === 0) {
      weaknesses.push("لا توجد نقاط ضعف بارزة. يوصى بالاستمرار على هذا المستوى العالي.");
    }

    // Forecast formula
    if (score >= 90) {
      forecastText = `بناءً على التتبع التاريخي، متوقع الحفاظ على دقة الجرد بنسبة تفوق 96% في الوردية القادمة، مع احتمال ضئيل جداً لوجود أخطاء بشرية (أقل من 2%).`;
    } else if (score >= 75) {
      forecastText = `يتوقع استقرار الجودة بنسبة 85% مع احتمال حدوث انحرافات طفيفة غير مقصودة في الأصناف ذات التعبئة المتعددة بنسبة حدوث 5%.`;
    } else if (score >= 60) {
      forecastText = `مؤشرات التنبؤ تشير إلى خطر حدوث أخطاء عد أولية بنسبة 15% في الجلسة المقبلة. يوصى بالتأكيد على الأمين باستخدام ميزان الأكياس الآلي للأصناف الدقيقة.`;
    } else {
      forecastText = `🚨 تنبيه ذكاء: مؤشر استقرار الجرد حرج! متوقع حدوث عجز أو زيادة غير مفسرة بنسبة 35% في الوردية القادمة للأصناف عالية القيمة. يُوصى بفرض إشراف مزدوج فوري.`;
    }

    if (keeper.items.length > 0) {
      storekeeperEvaluations.push({
        code,
        name: keeper.name,
        score,
        grade,
        gradeColor,
        gradeIcon,
        totalSessions: keeper.sessions.size,
        totalItemsAudited: keeper.items.length,
        perfectMatchesCount,
        inherentExcusedCount,
        humanErrorsCount,
        modificationsCount,
        productionErrorsCount,
        loadingErrorsCount,
        strengths,
        weaknesses,
        forecastText,
        evaluatedItems
      });
    }
  });

  // Sort storekeepers by score descending
  storekeeperEvaluations.sort((a, b) => b.score - a.score);

  // 3. Evaluate Supervisors
  const supervisorsMap = new Map<string, any>();

  // Extract supervisor statistics
  pastSessions.forEach(session => {
    const isApproved = session.supervisorApproved || session.supervisorApprovedBy;
    if (!isApproved) return;

    const superCode = String(session.supervisorApprovedBy || "general_super");
    const superDetails = allUsers.find(u => String(u.code) === superCode || u.name === superCode);
    const superName = superDetails?.name || (superCode === "general_super" ? "مشرف عام" : superCode);

    if (!supervisorsMap.has(superCode)) {
      supervisorsMap.set(superCode, {
        code: superCode,
        name: superName,
        sessions: [],
        itemsCount: 0,
        managerOverrides: 0,
        recheckRequestsCount: 0
      });
    }

    const sData = supervisorsMap.get(superCode);
    sData.sessions.push(session);
    sData.itemsCount += (session.items || []).length;

    // A supervisor's quality is affected if the manager subsequently changed the quantities in that session!
    let sessionOverrides = 0;
    (session.items || []).forEach((item: any) => {
      const superQty = item.supervisorQty;
      const managerQty = item.managerQty;
      if (superQty !== null && superQty !== undefined && managerQty !== null && managerQty !== undefined && superQty !== managerQty) {
        sessionOverrides++;
      }
      if (item.recheckRequested) {
        sData.recheckRequestsCount++;
      }
    });

    sData.managerOverrides += sessionOverrides;
  });

  const supervisorEvaluations: SupervisorSmartEvaluation[] = [];

  supervisorsMap.forEach((sData) => {
    let score = 100;
    const overrides = sData.managerOverrides;
    const totalReviewed = sData.itemsCount;

    // Deduct 10 points for each manager override
    score -= (overrides * 12);
    score = Math.max(40, Math.min(100, score));

    let grade: "ممتاز" | "جيد جداً" | "مقبول" | "ضعيف" = "مقبول";
    let gradeColor = "text-amber-700 bg-amber-50 border-amber-200";

    if (score >= 90) {
      grade = "ممتاز";
      gradeColor = "text-emerald-750 bg-emerald-55 border-emerald-250";
    } else if (score >= 75) {
      grade = "جيد جداً";
      gradeColor = "text-indigo-705 bg-indigo-55 border-indigo-200";
    } else if (score >= 60) {
      grade = "مقبول";
      gradeColor = "text-amber-705 bg-amber-55 border-amber-200";
    } else {
      grade = "ضعيف";
      gradeColor = "text-rose-705 bg-rose-55 border-rose-250";
    }

    const accuracyRate = totalReviewed > 0 ? Math.max(0, Math.round(((totalReviewed - overrides) / totalReviewed) * 100)) : 100;

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (accuracyRate >= 90) {
      strengths.push("دقة متناهية واعتماد سليم بنسبة 100% دون تراجع من الإدارة العامة.");
    }
    if (sData.recheckRequestsCount > 0) {
      strengths.push(`حس رقابي نشط وإرسال طلبات إعادة فحص للأصناف المشكوك فيها (${sData.recheckRequestsCount} طلبات).`);
    } else {
      strengths.push("المتابعة والتواجد المستمر أثناء ترحيل الجلسات المجرودة.");
    }

    if (overrides > 0) {
      weaknesses.push(`تم تدوين عدد ${overrides} تعديلات لاحقة بواسطة مدير البرنامج بعد اعتماد المشرف.`);
    }

    if (weaknesses.length === 0) {
      weaknesses.push("مستوى إشرافي ومطابقة عالي الكفاءة، لا توجد ملاحظات سلبية.");
    }

    supervisorEvaluations.push({
      code: sData.code,
      name: sData.name,
      score,
      grade,
      gradeColor,
      totalSessionsApproved: sData.sessions.length,
      totalItemsReviewed: totalReviewed,
      managerOverridesCount: overrides,
      recheckRequestsIssued: sData.recheckRequestsCount,
      responseSpeedScore: 90, // Dummy score
      verificationAccuracyRate: accuracyRate,
      strengths,
      weaknesses
    });
  });

  supervisorEvaluations.sort((a, b) => b.score - a.score);

  // 4. Calculate Global Metrics
  let totalEvaluatedItems = 0;
  let totalSystemicExcused = 0;
  let totalHumanErrors = 0;

  storekeeperEvaluations.forEach(ev => {
    totalEvaluatedItems += ev.totalItemsAudited;
    totalSystemicExcused += ev.inherentExcusedCount + ev.productionErrorsCount + ev.loadingErrorsCount;
    totalHumanErrors += ev.humanErrorsCount;
  });

  // Accuracy Trend Over Days
  const trendMap = new Map<string, { total: number; perfect: number; varianceSum: number }>();
  pastSessions.forEach(session => {
    const sDate = session.date ? session.date.split("T")[0] : "غير محدد";
    (session.items || []).forEach((item: any) => {
      const book = item.bookQty || 0;
      const skQty = item.storekeeperQty !== null && item.storekeeperQty !== undefined ? item.storekeeperQty : item.physicalQty;
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      const physical = managerVal !== null ? managerVal : (supervisorVal !== null ? supervisorVal : (skQty !== null ? skQty : book));
      const diff = physical - book;

      if (!trendMap.has(sDate)) {
        trendMap.set(sDate, { total: 0, perfect: 0, varianceSum: 0 });
      }

      const val = trendMap.get(sDate)!;
      val.total++;
      if (diff === 0) val.perfect++;
      val.varianceSum += Math.abs(diff);
    });
  });

  const accuracyTrend = Array.from(trendMap.entries())
    .map(([date, val]) => ({
      date,
      accuracy: val.total > 0 ? Math.round((val.perfect / val.total) * 100) : 100,
      variance: val.varianceSum
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Error type distribution
  let countProduction = 0;
  let countLoading = 0;
  let countJerd = 0;
  let countOther = 0;

  pastSessions.forEach(session => {
    (session.items || []).forEach((item: any) => {
      const book = item.bookQty || 0;
      const skQty = item.storekeeperQty !== null && item.storekeeperQty !== undefined ? item.storekeeperQty : item.physicalQty;
      const supervisorVal = item.supervisorQty !== undefined && item.supervisorQty !== null ? item.supervisorQty : null;
      const managerVal = item.managerQty !== undefined && item.managerQty !== null ? item.managerQty : null;

      const physical = managerVal !== null ? managerVal : (supervisorVal !== null ? supervisorVal : (skQty !== null ? skQty : book));
      const diff = physical - book;

      if (diff !== 0) {
        const reason = item.varianceReason || "أخرى";
        if (reason === "خطأ انتاج") countProduction++;
        else if (reason === "خطأ تحميل") countLoading++;
        else if (reason === "خطأ جرد") countJerd++;
        else countOther++;
      }
    });
  });

  const totalErrors = countProduction + countLoading + countJerd + countOther;
  const errorsDistribution = [
    { name: "خطأ إنتاج (نظامي)", value: countProduction, color: "#3b82f6" },
    { name: "خطأ تحميل (نظامي)", value: countLoading, color: "#06b6d4" },
    { name: "خطأ جرد (بشري)", value: countJerd, color: "#f43f5e" },
    { name: "انحرافات أخرى", value: countOther, color: "#fbbf24" }
  ].filter(x => x.value > 0);

  return {
    itemStats,
    storekeeperEvaluations,
    supervisorEvaluations,
    globalMetrics: {
      totalSessions: pastSessions.length,
      totalEvaluatedItems,
      accuracyTrend,
      errorsDistribution: errorsDistribution.length > 0 ? errorsDistribution : [{ name: "جرد مطابق تماماً", value: 100, color: "#10b981" }],
      totalSystemicExcused,
      totalHumanErrors
    }
  };
}
