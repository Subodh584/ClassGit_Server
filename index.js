import nodemailer from "nodemailer";
import express, { query } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import pool from "./db.js";
import { assign } from "nodemailer/lib/shared/index.js";
import axios from "axios";

dotenv.config();
const app = express();
const PORT = 3000;

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type,Authorization",
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.post("/sign-up-form-submission", async (req, res) => {
  try {
    const query = `INSERT INTO users (email, sectionid, name, password, role) VALUES (($1), ($2), ($3), ($4), ($5))`;
    const section = req.body.section ? parseInt(req.body.section) : null;
    const recData = [
      req.body.userEmail,
      section,
      `${req.body.fName} ${req.body.lName}`,
      req.body.password,
      req.body.role,
    ];
    const response = await pool.query(query, recData);
    res.send(req.body);
  } catch (err) {
    res.send(err);
    console.error(err);
  }
});

app.post("/log-in-form-submission", async (req, res) => {
  // Generate unique session ID
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  const sessionId = `${timestamp}-${randomPart}`;

  try {
    // Update user's session_id and return the updated row
    const query = `
        UPDATE users
        SET session_id = $1 
        WHERE email = $2 
        RETURNING *;
      `;
    const recData = [sessionId, req.body.userEmail];
    const response = await pool.query(query, recData);

    // Check if user exists
    if (response.rows.length === 0) {
      return res.json({ validity: 0, message: "User not found" });
    }

    // Verify password
    if (req.body.password == response.rows[0].password) {
      res.json({
        validity: response.rows[0].role == "Student" ? 1 : 2,
        UserName: `${response.rows[0].name}`,
        sessionId: sessionId,
        email: response.rows[0].email,
        role: response.rows[0].role,
      });
    } else {
      res.json({ validity: 0, message: "Invalid password" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/authenticatePrivateComponent", async (req, res) => {
  try {
    const { email, userName, sessionId, role } = req.body;

    // Split userName into first name and last name

    const query = `
        SELECT * FROM users
        WHERE email = $1 
        AND name = $2 
        AND session_id = $3
        AND role = $4
      `;

    const values = [email, userName, sessionId, role];
    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      // Match found in database
      res.json({ authenticated: true });
    } else {
      // No match found
      res.json({ authenticated: false });
    }
  } catch (err) {
    console.error("Authentication error:", err);
    res.status(500).json({ error: "Server error", authenticated: false });
  }
});

app.post("/dashboard-data-assignments", async (req, res) => {
  try {
    const query = `
        SELECT 
    a.AssignmentID AS id,
    a.Title AS name,
    sub.SubjectName AS class,
    TO_CHAR(a.DueDate, 'Month DD, YYYY') AS deadline,
    a.MinTeamMembers AS minTeamMembers,
    a.MaxTeamMembers AS maxTeamMembers,
    CASE
        WHEN sa.TeamStatus = 'Not Joined' THEN 'Not Joined'
        WHEN sa.TeamStatus = 'Forming Team' THEN 'Forming Team'
        WHEN sa.TeamStatus = 'Team Complete' THEN 'Team Complete'
    END AS teamStatus,
    sa.SubmissionStatus AS submissionStatus,
    sa.Progress AS progress,
    -- Get the team ID if the student is in a team for this assignment
    (SELECT tm.TeamID 
     FROM TeamMembers tm 
     JOIN Teams t ON tm.TeamID = t.TeamID 
     WHERE t.AssignmentID = a.AssignmentID AND tm.StudentEmail = sa.StudentEmail
     LIMIT 1) AS teamId
FROM Assignments a
JOIN StudentsAssignments sa ON a.AssignmentID = sa.AssignmentID
JOIN Subjects sub ON a.SubjectID = sub.SubjectID
WHERE sa.StudentEmail = $1;
        `;
    const test_email = `${req.body.userEmail}`;
    const values = [test_email];
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/dashboard-data-stats", async (req, res) => {
  const query = `
SELECT 
    COALESCE(s.ActiveAssignments, 0) AS activeAssignments,
    COALESCE(s.UpcomingDeadlines, 0) AS upcomingDeadlines,
    COALESCE(i.PendingInvitations, 0) AS pendingInvitations
FROM StudentAssignmentStats s
LEFT JOIN StudentInvitationStats i ON s.StudentEmail = i.StudentEmail
WHERE s.StudentEmail = $1;
  `;
  const values = [req.body.userEmail];
  try {
    const response = await pool.query(query, values);
    res.json(response.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/dashboard-data-teams", async (req, res) => {
  try {
    const query = `
SELECT 
    t.TeamID AS id,
    t.TeamName AS name,
    t.ProjectName AS project,
    a.Title AS assignment,
    t.MaxTeamMembers AS maxmembers,
    (
        SELECT json_agg(json_build_object(
            'id', tm_user.Email,
            'name', tm_user.Name,
            'role', tm_inner.Role,
            'avatar', SUBSTRING(tm_user.Name, 1, 1) || SUBSTRING(SPLIT_PART(tm_user.Name, ' ', 2), 1, 1)
        ))
        FROM TeamMembers tm_inner
        JOIN Users tm_user ON tm_inner.StudentEmail = tm_user.Email
        WHERE tm_inner.TeamID = t.TeamID
    ) AS members,
    COALESCE(r.Status, 'Not Connected') AS repoStatus,
    r.RepoName AS repoName
FROM Teams t
JOIN Assignments a ON t.AssignmentID = a.AssignmentID
LEFT JOIN Repositories r ON t.TeamID = r.TeamID
WHERE t.TeamID IN (
    SELECT tm.TeamID 
    FROM TeamMembers tm 
    WHERE tm.StudentEmail = $1
);
`;
    const values = [req.body.userEmail];
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// In your Express backend file

app.post("/student-dashboard-data-view-team-detail", async (req, res) => {
  const { assignmentId, studentEmail } = req.body;

  // Input validation
  if (!assignmentId || !studentEmail) {
    return res.status(400).json({
      success: false,
      message: "Assignment ID and student email are required",
    });
  }

  try {
    // Get assignment details
    const assignmentQuery = `
      SELECT a.*, s.subjectname, u.name as teacher_name 
      FROM assignments a
      JOIN subjects s ON a.subjectid = s.subjectid
      JOIN users u ON a.createdby = u.email
      WHERE a.assignmentid = $1
    `;
    const assignmentResult = await pool.query(assignmentQuery, [assignmentId]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    const assignmentDetails = assignmentResult.rows[0];

    // Get student's assignment status
    const studentAssignmentQuery = `
      SELECT status, progress, submissionstatus, teamstatus
      FROM studentsassignments
      WHERE studentemail = $1 AND assignmentid = $2
    `;
    const studentAssignmentResult = await pool.query(studentAssignmentQuery, [
      studentEmail,
      assignmentId,
    ]);

    if (studentAssignmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student is not enrolled in this assignment",
      });
    }

    const studentAssignment = studentAssignmentResult.rows[0];

    // Get team information if student is part of a team
    let teamInfo = null;
    let teamMembers = [];
    let repository = null;

    const teamQuery = `
      SELECT t.* 
      FROM teams t
      JOIN teammembers tm ON t.teamid = tm.teamid
      WHERE tm.studentemail = $1 AND t.assignmentid = $2
    `;
    const teamResult = await pool.query(teamQuery, [
      studentEmail,
      assignmentId,
    ]);

    if (teamResult.rows.length > 0) {
      teamInfo = teamResult.rows[0];

      // Get team members
      const teamMembersQuery = `
        SELECT tm.studentemail, tm.role, u.name, u.email as id
        FROM teammembers tm
        JOIN users u ON tm.studentemail = u.email
        WHERE tm.teamid = $1
      `;
      const teamMembersResult = await pool.query(teamMembersQuery, [
        teamInfo.teamid,
      ]);
      teamMembers = teamMembersResult.rows.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.studentemail,
        role: member.role,
        avatar: null, // You can add avatar logic if you have it
      }));

      // Get repository info
      const repoQuery = `
        SELECT repoid, reponame, status
        FROM repositories
        WHERE teamid = $1
      `;
      const repoResult = await pool.query(repoQuery, [teamInfo.teamid]);

      if (repoResult.rows.length > 0) {
        repository = {
          repoId: repoResult.rows[0].repoid,
          repoName: repoResult.rows[0].reponame,
          status: repoResult.rows[0].status,
        };
      }
    }

    // Get review information
    const reviewConfigsQuery = `
      SELECT configid, review_number, total_marks, review_description as title
      FROM assignment_review_configs
      WHERE assignmentid = $1
      ORDER BY review_number
    `;
    const reviewConfigsResult = await pool.query(reviewConfigsQuery, [
      assignmentId,
    ]);

    // Get student's review scores
    const studentReviewsQuery = `
      SELECT review_number, obtained_marks, review_status, review_comments
      FROM student_assignment_reviews
      WHERE assignmentid = $1 AND studentemail = $2
    `;
    const studentReviewsResult = await pool.query(studentReviewsQuery, [
      assignmentId,
      studentEmail,
    ]);

    // Combine review configs with student scores
    const reviews = reviewConfigsResult.rows.map((config) => {
      const studentReview = studentReviewsResult.rows.find(
        (review) => review.review_number === config.review_number
      );

      return {
        id: config.configid,
        title: config.title || `Review ${config.review_number}`,
        description: config.review_description || "",
        maxMarks: parseFloat(config.total_marks),
        marks: studentReview
          ? parseFloat(studentReview.obtained_marks || 0)
          : 0,
        status: studentReview ? studentReview.review_status : "Pending",
        comments: studentReview ? studentReview.review_comments : "",
      };
    });

    res.json({
      success: true,
      teamData: {
        assignment: {
          title: assignmentDetails.title,
          description: assignmentDetails.description,
          dueDate: assignmentDetails.duedate,
          minTeamMembers: assignmentDetails.minteammembers,
          maxTeamMembers: assignmentDetails.maxteammembers,
        },
        subject: {
          subjectId: assignmentDetails.subjectid,
          subjectName: assignmentDetails.subjectname,
        },
        teacher: {
          email: assignmentDetails.createdby,
          name: assignmentDetails.teacher_name,
        },
        progress: studentAssignment.progress,
        submissionStatus: studentAssignment.submissionstatus,
        teamStatus: studentAssignment.teamstatus,
        team: teamInfo,
        teamMembers: teamMembers,
        repository: repository,
        reviews: reviews,
        completionPercentage: studentAssignment.progress || 0,
      },
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team details",
      error: error.message,
    });
  }
});

app.post("/repo-data-conOrNo", async (req, res) => {
  console.log(req.body);
  const query = `SELECT 
    sa.assignmentid,
    a.title AS assignment_title,
    COALESCE(r.status, 'No Repository') AS repository_status
FROM studentsassignments sa
JOIN assignments a ON sa.assignmentid = a.assignmentid
LEFT JOIN teammembers tm ON sa.studentemail = tm.studentemail
LEFT JOIN teams t ON tm.teamid = t.teamid AND t.assignmentid = sa.assignmentid
LEFT JOIN repositories r ON t.teamid = r.teamid
WHERE sa.studentemail = $1 -- Student's email as first parameter
AND sa.assignmentid = ANY($2); -- Array of assignment IDs as second parameter`;

  const values = [req.body.userEmail, req.body.assIds];

  try {
    const response = await pool.query(query, values);
    console.log(response.rows);
  } catch (err) {
    console.error(err);
  }
});

app.post("/dashboard-data-invitations", async (req, res) => {
  try {
    const query = `
    SELECT 
        i.InvitationID AS id,
        sender.Name AS sender,
        t.TeamName AS teamName,
        a.Title AS assignment,
        sub.SubjectName AS class,
        i.Status AS status,
        CASE
            WHEN i.created_at > NOW() - INTERVAL '24 hours' THEN 
                EXTRACT(HOUR FROM NOW() - i.created_at) || ' hours ago'
            WHEN i.created_at > NOW() - INTERVAL '48 hours' THEN 'Yesterday'
            ELSE EXTRACT(DAY FROM NOW() - i.created_at) || ' days ago'
        END AS sentAt
    FROM Invitations i
    JOIN Users sender ON i.SenderEmail = sender.Email
    JOIN Teams t ON i.TeamID = t.TeamID
    JOIN Assignments a ON t.AssignmentID = a.AssignmentID
    JOIN Subjects sub ON a.SubjectID = sub.SubjectID
    WHERE i.ReceiverEmail = $1;
    `;

    const values = [`${req.body.userEmail}`];
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/dashboard-data-upcomingDeadlines", async (req, res) => {
  try {
    const query = `SELECT 
    a.title,
    s.subjectname,
    TO_CHAR(a.duedate, 'Month DD, YYYY') AS due_date,
    CASE 
        WHEN a.duedate >= CURRENT_DATE THEN a.duedate - CURRENT_DATE
        ELSE -1 * (CURRENT_DATE - a.duedate)
    END AS days_left
FROM 
    studentsassignments sa
JOIN 
    assignments a ON sa.assignmentid = a.assignmentid
JOIN 
    subjects s ON a.subjectid = s.subjectid
WHERE 
    sa.studentemail = $1
    AND sa.status = 'Pending'
ORDER BY 
    a.duedate ASC
LIMIT 3;`;
    const values = [`${req.body.userEmail}`];
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.log(err);
  }
});

app.post("/dashboard-data-events", async (req, res) => {
  const query = `WITH student_deadlines AS (
  SELECT 
    a.duedate,
    TO_CHAR(a.duedate, 'YYYY-MM') AS year_month,
    EXTRACT(DAY FROM a.duedate) AS day
  FROM studentsassignments sa
  JOIN assignments a ON sa.assignmentid = a.assignmentid
  WHERE sa.studentemail = $1
  AND a.duedate >= CURRENT_DATE
  ORDER BY a.duedate
),
grouped_deadlines AS (
  SELECT 
    year_month,
    ARRAY_AGG(day::integer ORDER BY day) AS days
  FROM student_deadlines
  GROUP BY year_month
)
SELECT 
  json_object_agg(year_month, days) AS events
FROM grouped_deadlines;`;
  const values = [`${req.body.userEmail}`];
  const response = await pool.query(query, values);
  res.json(response.rows[0]);
});

app.post("/tDashboard-data-subjects", async (req, res) => {
  try {
    const query = `SELECT s.subjectid, s.subjectname
FROM subjects s
JOIN teacherssubjects ts ON s.subjectid = ts.subjectid
WHERE ts.teacheremail = ($1);`;
    const values = [`${req.body.userEmail}`];
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});
app.post("/tDashboard-create-assignment", async (req, res) => {
  console.log(req.body);
  console.log(req.body.reviews);

  const reviewNoList = req.body.reviews.map((item) => parseInt(item.reviewNo));
  const reviewNameList = req.body.reviews.map((item) => item.reviewName);
  const reviewDiscriptionList = req.body.reviews.map(
    (item) => item.description
  );
  const reviewMarksList = req.body.reviews.map((item) =>
    parseFloat(item.reviewMarks)
  );

  console.log(
    reviewNoList,
    reviewNameList,
    reviewDiscriptionList,
    reviewMarksList
  );

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const assignmentResult = await client.query(
        `INSERT INTO public.assignments 
        (title, description, duedate, subjectid, createdby, minteammembers, maxteammembers)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING assignmentid`,
        [
          req.body.title,
          req.body.description,
          req.body.dueDate,
          req.body.subject,
          req.body.createdby,
          req.body.minMembers,
          req.body.maxMembers,
        ]
      );

      const assignmentId = assignmentResult.rows[0].assignmentid;

      await client.query(
        `INSERT INTO public.assignmentssections (assignmentid, sectionid)
        VALUES ($1, $2)`,
        [assignmentId, req.body.section]
      );

      for (let i = 0; i < reviewNoList.length; i++) {
        await client.query(
          `INSERT INTO public.assignment_review_configs 
          (assignmentid, review_number, total_marks, review_description)
          VALUES ($1, $2, $3, $4)`,
          [
            assignmentId,
            reviewNoList[i],
            reviewMarksList[i],
            reviewDiscriptionList[i],
          ]
        );
      }

      const studentsResult = await client.query(
        `SELECT email 
        FROM users 
        WHERE sectionid = $1 AND role = 'Student'`,
        [req.body.section]
      );

      // Determine the appropriate team status based on maxTeamMembers
      let teamStatus = "Not Joined";
      if (parseInt(req.body.maxMembers) === 1) {
        teamStatus = "Team Complete"; // Individual work doesn't need team joining
      }

      for (const student of studentsResult.rows) {
        await client.query(
          `INSERT INTO public.studentsassignments 
          (studentemail, assignmentid, status, progress, submissionstatus, teamstatus)
          VALUES ($1, $2, 'Pending', 0, 'Not Submitted', $3)`,
          [student.email, assignmentId, teamStatus]
        );

        for (const reviewNo of reviewNoList) {
          await client.query(
            `INSERT INTO public.student_assignment_reviews 
            (assignmentid, studentemail, review_number, obtained_marks, review_status,review_date,completetion_status)
            VALUES ($1, $2, $3, NULL, 'Pending', NULL, 'Not Completed')`,
            [assignmentId, student.email, reviewNo]
          );
        }
      }

      await client.query("COMMIT");

      const subjectResult = await client.query(
        `SELECT subjectname FROM subjects WHERE subjectid = $1`,
        [req.body.subject]
      );
      const subject = subjectResult.rows[0].subjectname;

      const dataForEmail = {
        createdBy: req.body.createdbyName,
        description: req.body.description,
        title: req.body.title,
        dueDate: req.body.dueDate,
        subject: subject,
      };

      if (req.body.sendMail === true || req.body.sendMail === "true") {
        for (const student of studentsResult.rows) {
          await sendAssignmentEmail(student.email, dataForEmail);
        }
      }

      res.json({ assignmentid: assignmentId });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ error: "Failed to create assignment" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database connection error" });
  }
});

app.get("/tDashboard-data-sections", async (req, res) => {
  try {
    const query = `SELECT sectionid, sectionname 
      FROM public.sections 
      ORDER BY sectionname;`;
    const response = await pool.query(query);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});

app.post("/tDashboard-add-subject", async (req, res) => {
  try {
    const query = `WITH new_subject AS (
    INSERT INTO public.subjects 
    (subjectname)
    VALUES 
    ($1)
    RETURNING subjectid
),
teacher_subject_mapping AS (
    INSERT INTO public.teacherssubjects 
    (teacheremail, subjectid)
    SELECT $2, subjectid 
    FROM new_subject
)
SELECT subjectid FROM new_subject;`;
    const values = [req.body.newSubject, req.body.userEmail];
    const response = await pool.query(query, values);
    console.log(response);
    res.send(response.rows[0]);
  } catch (err) {
    console.error(err);
  }
});

app.post("/tDashboard-data-assignments", async (req, res) => {
  try {
    const query = `SELECT 
    a.assignmentid,
    a.title,
    s.subjectname AS course,
    a.duedate,
    (SELECT COUNT(*) 
     FROM studentsassignments sa 
     WHERE sa.assignmentid = a.assignmentid 
     AND sa.submissionstatus = 'Submitted') AS submissions,
    (SELECT COUNT(*) 
     FROM studentsassignments sa 
     WHERE sa.assignmentid = a.assignmentid) AS totalStudents,
    CASE 
        WHEN a.duedate >= CURRENT_DATE THEN 'active'
        ELSE 'completed'
    END AS status
FROM 
    assignments a
JOIN 
    subjects s ON a.subjectid = s.subjectid
WHERE 
    a.createdby = $1  -- Teacher's email
ORDER BY 
    a.duedate;`;
    const values = [req.body.userEmail];

    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});

// Updated /available-students endpoint
app.post("/available-students", async (req, res) => {
  const { userEmail, assignmentId } = req.body;

  try {
    const client = await pool.connect();

    try {
      // If assignmentId is provided, use it directly
      if (assignmentId) {
        // Get the user's section
        const userSectionQuery = await client.query(
          `SELECT sectionid FROM users WHERE email = $1`,
          [userEmail]
        );

        if (userSectionQuery.rows.length === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        const sectionid = userSectionQuery.rows[0].sectionid;

        // Find students in the same section who haven't joined any team for this specific assignment
        const studentsQuery = await client.query(
          `SELECT u.email, u.name
           FROM users u
           JOIN studentsassignments sa ON u.email = sa.studentemail
           WHERE u.sectionid = $1 
           AND sa.assignmentid = $2
           AND sa.teamstatus = 'Not Joined'
           AND u.email != $3
           AND u.role = 'Student'
           ORDER BY u.name`,
          [sectionid, assignmentId, userEmail]
        );

        res.json(studentsQuery.rows);
      } else {
        // Fallback to original code if no assignmentId is provided
        const userQuery = await client.query(
          `SELECT u.sectionid, sa.assignmentid 
           FROM users u
           JOIN studentsassignments sa ON u.email = sa.studentemail
           JOIN assignments a ON sa.assignmentid = a.assignmentid
           WHERE u.email = $1 AND (sa.teamstatus = 'Not Joined' OR sa.teamstatus = 'Forming Team')`,
          [userEmail]
        );

        if (userQuery.rows.length === 0) {
          return res
            .status(404)
            .json({ error: "No eligible assignments found for the user" });
        }

        const { sectionid, assignmentid } = userQuery.rows[0];

        const studentsQuery = await client.query(
          `SELECT u.email, u.name
           FROM users u
           JOIN studentsassignments sa ON u.email = sa.studentemail
           WHERE u.sectionid = $1 
           AND sa.assignmentid = $2
           AND sa.teamstatus = 'Not Joined'
           AND u.email != $3
           AND u.role = 'Student'
           ORDER BY u.name`,
          [sectionid, assignmentid, userEmail]
        );

        res.json(studentsQuery.rows);
      }
    } catch (err) {
      console.error("Error in query:", err);
      res.status(500).json({ error: "Error processing request" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error fetching available students:", err);
    res
      .status(500)
      .json({ error: "Database error while fetching available students" });
  }
});

app.post("/remaining-available-students", async (req, res) => {
  const query = `
  SELECT u.email, u.name
FROM users u
JOIN studentsassignments sa ON u.email = sa.studentemail
WHERE sa.assignmentid = (
    SELECT assignmentid 
    FROM teams 
    WHERE teamid = $1 
)
AND sa.teamstatus = 'Not Joined'
AND u.role = 'Student'
ORDER BY u.name;
  `;
  const values = [req.body.teamId];

  const response = await pool.query(query, values);
  console.log(response.rows);
  res.json(response.rows);
});

app.post("/send-team-invitation", async (req, res) => {
  const {
    senderEmail,
    recipientEmail,
    teamName,
    projectName,
    maxSize,
    assignmentId,
    teamId,
  } = req.body;

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let finalTeamId;

      // If teamId is provided, verify sender is a member of this team
      if (teamId) {
        const teamMemberQuery = await client.query(
          `SELECT tm.teamid 
           FROM teammembers tm
           WHERE tm.teamid = $1 AND tm.studentemail = $2`,
          [teamId, senderEmail]
        );

        if (teamMemberQuery.rows.length > 0) {
          // Sender is a member of this team, use this teamId
          finalTeamId = teamId;
        } else {
          // TeamId provided but sender is not a member
          // Will fall back to regular flow of creating or finding team
          finalTeamId = null;
        }
      }

      // If no valid teamId was provided or found, proceed with original logic
      if (!finalTeamId) {
        // Check if team exists for this sender and assignment that they lead
        let teamQuery = await client.query(
          `SELECT t.teamid 
           FROM teams t
           JOIN teammembers tm ON t.teamid = tm.teamid
           WHERE tm.studentemail = $1 
           AND tm.role = 'Leader'
           AND t.teamname = $2
           AND t.assignmentid = $3`,
          [senderEmail, teamName, assignmentId]
        );

        if (teamQuery.rows.length === 0) {
          // Create new team with the provided assignmentId
          const createTeamResult = await client.query(
            `INSERT INTO teams (teamname, createdby, projectname, assignmentid, maxteammembers)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING teamid`,
            [teamName, senderEmail, projectName, assignmentId, maxSize]
          );

          finalTeamId = createTeamResult.rows[0].teamid;

          // Add the creator as team leader
          await client.query(
            `INSERT INTO teammembers (teamid, studentemail, role)
             VALUES ($1, $2, 'Leader')`,
            [finalTeamId, senderEmail]
          );

          // Update sender's team status
          await client.query(
            `UPDATE studentsassignments 
             SET teamstatus = 'Forming Team'
             WHERE studentemail = $1 AND assignmentid = $2`,
            [senderEmail, assignmentId]
          );
        } else {
          finalTeamId = teamQuery.rows[0].teamid;
        }
      }

      // Check team size against maximum allowed
      const currentMembersQuery = await client.query(
        `SELECT COUNT(*) as member_count 
         FROM teammembers 
         WHERE teamid = $1`,
        [finalTeamId]
      );

      const currentMembers = parseInt(currentMembersQuery.rows[0].member_count);

      // Get maximum team members for this team
      const maxTeamSizeQuery = await client.query(
        `SELECT maxteammembers FROM teams WHERE teamid = $1`,
        [finalTeamId]
      );

      const maxTeamMembers = maxTeamSizeQuery.rows[0].maxteammembers;

      // Get pending invitations count
      const pendingInvitationsQuery = await client.query(
        `SELECT COUNT(*) as pending_count 
         FROM invitations 
         WHERE teamid = $1 AND status = 'Pending'`,
        [finalTeamId]
      );

      // Check if recipient is already a member of the team
      const existingMemberQuery = await client.query(
        `SELECT studentemail FROM teammembers
         WHERE teamid = $1 AND studentemail = $2`,
        [finalTeamId, recipientEmail]
      );

      if (existingMemberQuery.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "User is already a member of this team",
        });
      }

      // Check if an invitation already exists
      const existingInvitation = await client.query(
        `SELECT invitationid, status FROM invitations
         WHERE receiveremail = $1 AND teamid = $2`,
        [recipientEmail, finalTeamId]
      );

      if (existingInvitation.rows.length > 0) {
        const invStatus = existingInvitation.rows[0].status;
        if (invStatus === "Pending") {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "An invitation is already pending for this user",
          });
        } else if (invStatus === "Rejected") {
          // Update the existing invitation to Pending status
          await client.query(
            `UPDATE invitations
             SET status = 'Pending', senderemail = $1, created_at = CURRENT_TIMESTAMP
             WHERE invitationid = $2`,
            [senderEmail, existingInvitation.rows[0].invitationid]
          );
        }
      } else {
        // Send new invitation
        await client.query(
          `INSERT INTO invitations (senderemail, receiveremail, teamid, status)
           VALUES ($1, $2, $3, 'Pending')`,
          [senderEmail, recipientEmail, finalTeamId]
        );
      }

      await client.query("COMMIT");

      // Return the teamId in the response
      res.json({
        success: true,
        message: "Invitation sent successfully",
        teamId: finalTeamId,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error sending team invitation:", err);
    res.status(500).json({ error: "Database error while sending invitation" });
  }
});

// POST create team
app.post("/create-team", async (req, res) => {
  console.log(req.body);
  const { userEmail, projectName, teamName, members, maxSize, assignmentId } =
    req.body;
  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get assignment ID and validate assignment eligibility
      const assignmentQuery = await client.query(
        `SELECT sa.assignmentid, a.maxteammembers 
         FROM studentsassignments sa
         JOIN assignments a ON sa.assignmentid = a.assignmentid
         WHERE sa.studentemail = $1 AND sa.teamstatus = 'Not Joined'
           AND sa.assignmentid = $2`,
        [userEmail, assignmentId]
      );

      if (assignmentQuery.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "No eligible assignment found with the specified ID for team creation",
        });
      }

      const { assignmentid, maxteammembers } = assignmentQuery.rows[0];

      // Validate team size
      const totalMembers = members.length + 1; // +1 for the creator
      if (totalMembers > maxteammembers) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Team size exceeds maximum allowed (${maxteammembers})`,
        });
      }

      // Create the team
      const createTeamResult = await client.query(
        `INSERT INTO teams (teamname, createdby, projectname, assignmentid, maxteammembers)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING teamid`,
        [teamName, userEmail, projectName, assignmentid, maxSize]
      );

      const teamId = createTeamResult.rows[0].teamid;

      // Add the creator as team leader
      await client.query(
        `INSERT INTO teammembers (teamid, studentemail, role)
         VALUES ($1, $2, 'Leader')`,
        [teamId, userEmail]
      );

      // Update creator's team status
      await client.query(
        `UPDATE studentsassignments 
         SET teamstatus = 'Forming Team'
         WHERE studentemail = $1 AND assignmentid = $2`,
        [userEmail, assignmentid]
      );

      // Create a repository entry
      await client.query(
        `INSERT INTO repositories (teamid, reponame, status)
         VALUES ($1, $2, 'Not Connected')`,
        [teamId, `Not Created`]
      );

      // Send invitations to all members
      for (const memberEmail of members) {
        await client.query(
          `INSERT INTO invitations (senderemail, receiveremail, teamid, status)
           VALUES ($1, $2, $3, 'Pending')`,
          [userEmail, memberEmail, teamId]
        );
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Team created successfully",
        teamId,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error creating team:", err);
    res.status(500).json({ error: "Database error while creating team" });
  }
});

app.post("/respond-invitation", async (req, res) => {
  try {
    const query = `UPDATE invitations 
    SET status = $1 
    WHERE invitationid = $2;`;
    const values = [req.body.invitationResponse, req.body.invitationId];
    const response = await pool.query(query, values);
    console.log(response);
    res.json(1);
  } catch (err) {
    console.error(err);
  }
});

app.post("/verify", async (req, res) => {
  const response = await sendVerificationEmail(req.body.email);
  res.json(response);
});

const baseEmail = process.env.EMAIL_ADDRESS;
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: baseEmail,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendVerificationEmail = async (email) => {
  const OTP = Math.floor(100000 + Math.random() * 900000);
  const mailOptions = {
    from: baseEmail,
    to: email,
    subject: "Email Verification",
    html: `<div><p>This email is to verify your account ${email} for the purpose of verification:</p><h3>Your OTP is ${OTP} </h3></div>`,
  };
  try {
    await transporter.sendMail(mailOptions);
    return OTP;
  } catch (error) {
    console.error("Error sending email:", error);
    return -1;
  }
};

const sendAssignmentEmail = async (email, dataForEmail) => {
  const mailOptions = {
    from: baseEmail,
    to: email,
    subject: `New Assignment by ${dataForEmail.createdBy}`,
    html: `<div><p>Hey there, a new assignment has been created by ${dataForEmail.createdBy} for the subject ${dataForEmail.subject}:</p><h3>${dataForEmail.title}</h3><p>${dataForEmail.description}</p><p>Due Date: ${dataForEmail.dueDate}</p></div>`,
  };
  try {
    await transporter.sendMail(mailOptions);
    return 1;
  } catch (err) {
    console.error(err);
    return -1;
  }
};

app.post("/checkRepoConnectivity", async (req, res) => {
  const query = `
  SELECT 
    r.status AS repo_status
FROM 
    users u
JOIN 
    teammembers tm ON u.email = tm.studentemail
JOIN 
    teams t ON tm.teamid = t.teamid
LEFT JOIN 
    repositories r ON t.teamid = r.teamid
WHERE 
    u.email = $1 
    AND t.assignmentid = $2 ;
  `;
  const values = [req.body.userEmail, req.body.assId];

  try {
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});

app.post("/checkUserAndRepo", async (req, res) => {
  const checkUserAndRepo = async () => {
    const username = req.body.username;
    const repository = req.body.repository;
    const token = req.body.token;
    const assId = req.body.assId;
    const userEmail = req.body.userEmail;

    try {
      const headers = token
        ? { Authorization: `token ${token}` }
        : { Authorization: `token ${process.env.SERVER_TOKEN_GITHUB}` };

      await axios.get(`https://api.github.com/users/${username}`, { headers });

      const repoResponse = await axios.get(
        `https://api.github.com/repos/${username}/${repository}`,
        { headers }
      );

      const sizeInKB = repoResponse.data.size;
      const sizeInMB = sizeInKB / 1024;

      if (sizeInMB > 100 && !token) {
        res.json(
          "Repository is too large. Please provide a Personal Access Token."
        );
        return;
      }

      // Log values for debugging
      console.log("Input parameters:", {
        userEmail,
        assId,
        repository,
        username,
      });

      try {
        const query = `
          WITH user_team AS (
            -- Find the team the user belongs to for this assignment
            SELECT t.teamid 
            FROM teammembers tm
            JOIN teams t ON tm.teamid = t.teamid
            WHERE tm.studentemail = $1
            AND t.assignmentid = $2
          )
          , repo_upsert AS (
            -- Check if repository exists for the team and update it, or insert if it doesn't exist
            INSERT INTO repositories (teamid, reponame, status, "RepoUserName")
            SELECT 
                (SELECT teamid FROM user_team),
                $3,
                'Connected',
                $4
            WHERE EXISTS (SELECT 1 FROM user_team)
            ON CONFLICT (teamid) 
            DO UPDATE SET 
                reponame = $3,
                status = 'Connected',
                "RepoUserName" = $4
            RETURNING *
          )
          SELECT * FROM repo_upsert;
        `;

        const values = [userEmail, assId, repository, username];
        console.log("Executing query with values:", values);

        const response = await pool.query(query, values);
        console.log("Database response:", response.rows);

        if (response.rows.length === 0) {
          const teamCheck = await pool.query(
            `
            SELECT t.teamid 
            FROM teammembers tm
            JOIN teams t ON tm.teamid = t.teamid
            WHERE tm.studentemail = $1
            AND t.assignmentid = $2
          `,
            [userEmail, assId]
          );

          if (teamCheck.rows.length === 0) {
            return res
              .status(404)
              .json(
                "No team found for this user and assignment. Please join or create a team first."
              );
          }
        }

        res.json("Repository linked successfully!");
      } catch (err) {
        console.error("Database error details:", err);
        res.status(500).json("Database error occurred when linking repository");
      }
    } catch (error) {
      // Existing error handling...
      console.error("Full error object:", error);
      console.error("Error response data:", error.response?.data);
      console.error("Error status:", error.response?.status);

      if (error.response && error.response.status === 404) {
        const url = error.config.url;
        if (url.includes("/users/")) {
          res.json("GitHub User Not Found!");
        } else if (url.includes("/repos/")) {
          res.json(`Repository ${repository} not found for user ${username}!`);
        } else {
          res.json("Something went wrong. Try again.");
        }
      } else {
        res.json("Network or Server Error!");
      }
    }
  };

  checkUserAndRepo();
});

app.post("/get-repo-and-user-name", async (req, res) => {
  const { assId, userEmail } = req.body;
  const query = `
  SELECT r."RepoUserName", r.reponame
FROM repositories r
JOIN teams t ON r.teamid = t.teamid
JOIN teammembers tm ON t.teamid = tm.teamid
WHERE tm.studentemail = $1
AND t.assignmentid = $2;
  `;
  const values = [userEmail, assId];
  try {
    const response = await pool.query(query, values);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});

app.post("/unlink-repo", async (req, res) => {
  const { assId, userEmail } = req.body;
  const query = `
  UPDATE repositories r
SET status = 'Not Connected'
FROM teams t
JOIN teammembers tm ON t.teamid = tm.teamid
WHERE r.teamid = t.teamid
AND tm.studentemail = $1
AND t.assignmentid = $2;
  `;
  const values = [userEmail, assId];
  console.log(values);
  try {
    const response = await pool.query(query, values);
    res.json("removed!");
  } catch (err) {
    console.error(err);
  }
});

app.post("/fetch-reviews", async (req, res) => {
  const assId = req.body.assId;
  const userEmail = req.body.userEmail;
  console.log(assId);
  const query = `
 WITH user_team AS (
    -- Get the team ID for the given user and assignment
    SELECT 
        tm.teamid
    FROM 
        teammembers tm
    JOIN 
        teams t ON tm.teamid = t.teamid
    WHERE 
        tm.studentemail = $1
        AND t.assignmentid = $2
),
team_completion_status AS (
    -- Check if any team member has completed each review
    SELECT 
        sar.review_number,
        COALESCE(MAX(sar.completetion_status), 'Not Completed') AS team_completion_status,
        -- Get the deadline for this review
        MAX(sar.review_deadline) AS review_deadline
    FROM 
        student_assignment_reviews sar
    JOIN 
        teammembers tm ON sar.studentemail = tm.studentemail
    JOIN 
        user_team ut ON tm.teamid = ut.teamid
    WHERE 
        sar.assignmentid = $2
    GROUP BY 
        sar.review_number
)

SELECT 
    arc.configid,
    arc.assignmentid,
    arc.review_number,
    arc.total_marks,
    arc.review_description,
    a.title AS assignment_name,
    COALESCE(tcs.team_completion_status, 'Not Completed') AS completion_status,
    tcs.review_deadline
FROM 
    assignment_review_configs arc
JOIN 
    assignments a ON arc.assignmentid = a.assignmentid
LEFT JOIN 
    team_completion_status tcs ON arc.review_number = tcs.review_number
WHERE 
    arc.assignmentid = $2
ORDER BY 
    arc.review_number;
  `;
  const values = [userEmail, assId];

  try {
    const response = await pool.query(query, values);
    console.log(response.rows);
    res.json(response.rows);
  } catch (err) {
    console.error(err);
  }
});

app.post("/submited-for-review", async (req, res) => {
  const { assId, userEmail, reviewId } = req.body;
  console.log(assId, userEmail, reviewId);
  const query = `
  WITH user_team AS (
    -- Find the team of the given user for the specific assignment
    SELECT tm.teamid
    FROM teammembers tm
    JOIN teams t ON tm.teamid = t.teamid
    WHERE tm.studentemail = $2
    AND t.assignmentid = $1
),
team_members AS (
    -- Find all team members in the user's team
    SELECT tm.studentemail
    FROM teammembers tm
    JOIN user_team ut ON tm.teamid = ut.teamid
)

-- Update completion status for all team members
UPDATE student_assignment_reviews
SET completetion_status = 'Completed'
WHERE assignmentid = $1
AND studentemail IN (SELECT studentemail FROM team_members)
AND review_number = (
    SELECT review_number 
    FROM assignment_review_configs 
    WHERE configid = $3
);
  `;
  const values = [assId, userEmail, reviewId];

  try{
    const response = await pool.query(query, values);
    console.log(response.rows);
    res.json(response.rows);
  }catch(err){
    console.error(err);
  }
});





app.post("/is-submited-for-review",async(req,res)=>{
  const {assId, userEmail} = req.body;
  const query = 
  `SELECT 
    sar.completetion_status
FROM 
    student_assignment_reviews sar
JOIN 
    assignment_review_configs arc ON sar.assignmentid = arc.assignmentid 
    AND sar.review_number = arc.review_number
WHERE 
    sar.assignmentid = $1
    AND sar.studentemail = $2
ORDER BY 
    sar.review_number;
  `
const values = [assId, userEmail];
console.log(values);
  try{
    const response = await pool.query(query, values);
    console.log(response.rows);
    res.json(response.rows);
  }catch(err){
    console.error(err);
  }


});



app.post("/dashboard-data-progress", async (req, res) => {
  const query = `
  WITH team_info AS (
    -- Get the team ID for the given student and assignment
    SELECT t.teamid 
    FROM teammembers tm
    JOIN teams t ON tm.teamid = t.teamid
    WHERE tm.studentemail = $1 
    AND t.assignmentid = $2
),
team_members AS (
    -- Get all team members for this team
    SELECT tm.studentemail
    FROM teammembers tm
    JOIN team_info ti ON tm.teamid = ti.teamid
),
total_reviews AS (
    -- Get total number of reviews configured for this assignment
    SELECT COUNT(*) AS total_count
    FROM assignment_review_configs
    WHERE assignmentid = $2
),
completed_reviews AS (
    -- Count reviews with completed status for any team member
    SELECT COUNT(DISTINCT arc.review_number) AS completed_count
    FROM assignment_review_configs arc
    JOIN student_assignment_reviews sar ON 
        arc.assignmentid = sar.assignmentid AND 
        arc.review_number = sar.review_number
    JOIN team_members tm ON sar.studentemail = tm.studentemail
    WHERE arc.assignmentid = $2
    AND sar.completetion_status = 'Completed'
)
-- Return all three values: reviews_done, reviews_total, and progress
SELECT 
    cr.completed_count AS reviews_done,
    tr.total_count AS reviews_total,
    COALESCE(
        (cr.completed_count::numeric / NULLIF(tr.total_count, 0) * 100), 
        0
    ) AS progress
FROM total_reviews tr
CROSS JOIN completed_reviews cr;`

const values = [req.body.userEmail, req.body.assId];
try{
  const response = await pool.query(query, values);
  console.log(response.rows);
  res.json(response.rows);
}catch(err){
  console.error(err);
}
});

app.post("/fetch-assignment-options",async(req,res)=>{
  const query = `
  WITH assignment_data AS (
    SELECT 
        a.assignmentid,
        a.title,
        a.duedate AS deadline
    FROM 
        assignments a
    WHERE 
        a.createdby = $1
),
review_data AS (
    SELECT 
        arc.assignmentid,
        arc.configid AS id,
        'Review ' || arc.review_number AS name,
        arc.review_description,
        arc.review_number,
        MAX(sar.review_deadline) AS deadline,
        CASE 
            WHEN MAX(sar.review_deadline) IS NULL THEN FALSE
            ELSE TRUE
        END AS permitted
    FROM 
        assignment_review_configs arc
    LEFT JOIN 
        student_assignment_reviews sar ON arc.assignmentid = sar.assignmentid AND arc.review_number = sar.review_number
    GROUP BY 
        arc.assignmentid, arc.configid, arc.review_number, arc.review_description
)
SELECT 
    ad.assignmentid AS id,
    ad.title,
    ad.deadline,
    COALESCE(
        json_agg(
            json_build_object(
                'id', rd.id,
                'name', rd.name,
                'deadline', rd.deadline,
                'permitted', rd.permitted
            )
            ORDER BY rd.review_number
        ) FILTER (WHERE rd.id IS NOT NULL),
        '[]'::json
    ) AS reviews
FROM 
    assignment_data ad
LEFT JOIN 
    review_data rd ON ad.assignmentid = rd.assignmentid
GROUP BY 
    ad.assignmentid, ad.title, ad.deadline
ORDER BY 
    ad.deadline;
  `
  const values = [req.body.userEmail];
  try{
    const response = await pool.query(query,values);
    res.json(response.rows);
  }catch(err){
    console.error(err);
  }
});

app.post("/save-review-settings", async (req, res) => {
  try {
    // We need to embed the parameters inside the query text
    const query = `
DO $$
DECLARE
    assignment_id INT := ${req.body.assId};
    reviews_data JSON := '${JSON.stringify(req.body.reviews)}';
    review_item JSON;
    config_id INT;
    deadline_text TEXT;
    deadline_date DATE;
    review_num INT;
BEGIN
    -- For each review in the array
    FOR i IN 0..json_array_length(reviews_data)-1 LOOP
        review_item := reviews_data->i;
        config_id := (review_item->>'id')::INT;
        deadline_text := review_item->>'deadline';
        
        -- Set deadline_date to NULL if deadline is not provided or empty
        IF deadline_text IS NULL OR deadline_text = '' OR deadline_text = 'null' THEN
            deadline_date := NULL;
        ELSE
            deadline_date := deadline_text::DATE;
        END IF;
        
        -- Get the review_number from assignment_review_configs using the config_id
        SELECT review_number INTO review_num
        FROM assignment_review_configs
        WHERE configid = config_id;
        
        IF review_num IS NOT NULL THEN
            -- Update the review_deadline for all students with this assignment and review number
            UPDATE student_assignment_reviews
            SET review_deadline = deadline_date
            WHERE assignmentid = assignment_id
            AND review_number = review_num;
        END IF;
    END LOOP;
    
    -- Handle reviews that might be in the database but not in the provided data
    -- Get all review numbers for this assignment
    FOR review_num IN 
        SELECT arc.review_number 
        FROM assignment_review_configs arc
        WHERE arc.assignmentid = assignment_id
        AND arc.configid NOT IN (
            SELECT (json_array_elements(reviews_data)->>'id')::INT
        )
    LOOP
        -- Set review_deadline to NULL for reviews not included in the data
        UPDATE student_assignment_reviews
        SET review_deadline = NULL
        WHERE assignmentid = assignment_id
        AND review_number = review_num;
    END LOOP;
END $$;
    `;
    
    // Execute without parameters
    await pool.query(query);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`Running at port ${PORT}`);
});
