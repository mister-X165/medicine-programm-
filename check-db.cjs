const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const counts = {
    doctors: await p.doctor.count(),
    cases: await p.case.count(),
    analyses: await p.analysisResult.count(),
    patients: await p.patient.count(),
  };
  console.log(JSON.stringify(counts));
  const c = await p.case.findFirst({ include: { analysis: true, doctor: true } });
  if (c) console.log(JSON.stringify({ id: c.id, code: c.caseCode, status: c.status, hasAnalysis: !!c.analysis, doctor: c.doctor?.fullName, structured: c.analysis?.structured?.slice(0, 200) }));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
