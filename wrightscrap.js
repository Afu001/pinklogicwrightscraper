const express = require("express");
const { chromium } = require("playwright");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(bodyParser.json());

app.post("/scrape", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data, subjects, marksData, lectureData } = await loginAndScrape(username, password);
    const numberOfSubjects = subjects.length;
    console.log(`Number of subjects: ${numberOfSubjects}`);

    
    const mergedData = subjects.map((subjectName) => {
      const matchingMarksData = marksData.find((md) => md.subjectName === subjectName) || {};
      const matchingLectureData = lectureData.find((ld) => ld.subjectName === subjectName) || {};
      return {
        subjectName,
        marksData: matchingMarksData.marksData || [],
        lectureData: matchingLectureData.lectureData || [],
        sumQuiz: matchingMarksData.sumQuiz || 0,
        sumAssignment: matchingMarksData.sumAssignment || 0,
        totalAbsences: matchingLectureData.totalAbsences || 0,
      };
    });

// i am logging merged data here
mergedData.forEach((subjectData) => {
  console.log(`Subject: ${subjectData.subjectName}`);
  console.log(`  Sum Quiz: ${subjectData.marksData.sumQuiz}`);
  console.log(`  Sum Assignment: ${subjectData.marksData.sumAssignment}`);
  console.log(`  Total Absent: ${subjectData.totalAbsences}`);

  //displaying marks obtained here
  console.log("  Marks Obtained for Quizzes:");
  if (Array.isArray(subjectData.marksData.marksData)) {
    subjectData.marksData.marksData.forEach((quizInfo) => {
      console.log(`    ${quizInfo.marksHead}: ${quizInfo.marksObtained}`);
    });
  } else {
    console.log("    No quiz data available");
  }

  // display marks obtained for each assignment
  console.log("  Marks Obtained for Assignments:");
  if (Array.isArray(subjectData.marksData.marksData)) {
    subjectData.marksData.marksData.forEach((assignmentInfo) => {
      console.log(`    ${assignmentInfo.marksHead}: ${assignmentInfo.marksObtained}`);
    });
  } else {
    console.log("    No assignment data available");
  }
});



    res.json({ data, subjects, marksData, lectureData, mergedData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});





const loginAndScrape = async (username, password) => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("https://fallzabdesk.szabist-isb.edu.pk/", {
      waitUntil: "domcontentloaded",
    });

    await page.fill('input[name="txtLoginName"]', username);
    await page.fill('input[name="txtPassword"]', password);
    await page.click('img[alt="ZABDESK Login"]');

    await page.goto(
      "https://fallzabdesk.szabist-isb.edu.pk/Student/QryCourseAttendance.asp",
      {
        waitUntil: "domcontentloaded",
      }
    );

    const data = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("td"));
      let name = "N/A";
      let reg = "N/A";
      let semester = "N/A";
      let cgpa = "N/A";

      for (let i = 0; i < elements.length; i++) {
        const text = elements[i].textContent.trim();

        if (text === "Student Name") {
          name = elements[i + 1].textContent.trim();
        } else if (text === "Registration Number") {
          reg = elements[i + 1].textContent.trim();
        } else if (text === "Semester") {
          semester = elements[i + 1].textContent.trim();
        } else if (text === "CGPA") {
          cgpa = elements[i + 1].textContent.trim();
        }
      }

      return { name, reg, semester, cgpa };
    });

    const subjectElements = await page.$$('a[href^="javascript:chkSubmit"]');
    const subjectNames = await Promise.all(
      subjectElements.map(async (element) => {
        const subjectName = await element.textContent();
        return subjectName.trim();
      })
    );

    // Looping through subjects
    const lectureData = [];
    for (let subjectIndex = 0; subjectIndex < subjectNames.length; subjectIndex++) {
      const subjectName = subjectNames[subjectIndex];
      try {
        await page.waitForSelector('a[href^="javascript:chkSubmit"]'); 
        const subjectElements = await page.$$('a[href^="javascript:chkSubmit"]');
        await subjectElements[subjectIndex].click();
        await page.waitForLoadState("domcontentloaded");

        const subjectLectureData = await page.evaluate(() => {
          const lectureData = [];
          let totalAbsences = 0;
          const lectureRows = document.querySelectorAll("table.textColor tr");

          for (let num = 1; num < lectureRows.length; num++) {
            const columns = lectureRows[num].querySelectorAll("td");
            if (columns.length === 3) {
              const lecture = columns[0].textContent.trim();
              const date = columns[1].textContent.trim();
              const attendanceStatus = columns[2].textContent.trim();

              if (attendanceStatus.toLowerCase() === "absent") {
                totalAbsences++;
              }

              lectureData.push({ lecture, date, attendanceStatus });
            }
          }
          return {lectureData, totalAbsences };
        });

        lectureData.push({ subjectName, lectureData: subjectLectureData.lectureData, totalAbsences: subjectLectureData.totalAbsences });

        // Go back to the main subjects page
        await page.goBack();
      } catch (error) {
        console.error(`Error clicking on subject "${subjectName}": ${error}`);
      }
    }

    await page.goto("https://fallzabdesk.szabist-isb.edu.pk/Student/QryCourseRecapSheet.asp?OptionName=Current%20Semester%20Results", {
      waitUntil: "domcontentloaded",
    });

    const marksData = [];

    for (let subjectIndex = 0; subjectIndex < subjectNames.length; subjectIndex++) {
      const subjectName = subjectNames[subjectIndex];
      try {
        await page.waitForSelector('a[href^="javascript:chkSubmit"]');
        const subjectElements = await page.$$('a[href^="javascript:chkSubmit"]');
        await subjectElements[subjectIndex].click();
        await page.waitForLoadState("domcontentloaded");

        const subjectMarksData = await page.evaluate(() => {
          const marksData = [];
          const marksRows = document.querySelectorAll("table.textColor tr");
          let sumQuiz = 0;
          let sumAssignment = 0;

          for (let i = 0; i < marksRows.length; i++) {
            const columns = marksRows[i].querySelectorAll("td");
            if (columns.length === 3) {
              const marksHead = columns[0].textContent.trim();
              const maxMarks = columns[1].textContent.trim();
              const marksObtained = columns[2].textContent.trim();
              marksData.push({ marksHead, maxMarks, marksObtained });
              if (marksObtained.toLowerCase() !== "not entered") {
                // i am checking if the marksHead includes "quiz" or "assignment"
                if (marksHead.toLowerCase().includes("quiz")) {
                  sumQuiz += 1;
                } else if (marksHead.toLowerCase().includes("assignment")) {
                  sumAssignment += 1;
                }
              }
            }
          }

          return { marksData, sumQuiz, sumAssignment};
        });

        marksData.push({ subjectName, marksData: subjectMarksData, lectureData, sumQuiz: subjectMarksData.sumQuiz, sumAssignment: subjectMarksData.sumAssignment });
        await page.goBack();
      } catch (error) {
        console.error(`Error clicking on subject "${subjectName}": ${error}`);
      }
    }

    return { data, subjects: subjectNames, marksData, lectureData };
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});