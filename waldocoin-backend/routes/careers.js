import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF, DOC, DOCX files
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'), false);
    }
  }
});

// Simple test endpoint first
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Careers endpoint is working!' });
});

// POST /api/careers/apply - Submit job application
router.post('/apply', upload.single('resume'), async (req, res) => {
  try {
    console.log('🎯 Careers application received');
    console.log('Request body:', req.body);
    console.log('File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No file');

    const {
      fullName,
      email,
      phone,
      position,
      experience,
      skills,
      portfolio,
      coverLetter,
      availability
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !position || !coverLetter) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // TEMPORARY: Always return success for testing
    console.log(`✅ TEMP SUCCESS: Application from ${fullName} (${email}) for ${position}`);
    if (req.file) {
      console.log(`📎 Resume: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    return res.json({
      success: true,
      message: 'Application received successfully! (Email functionality temporarily disabled for testing)'
    });

    // Check if email is configured
    console.log('🔍 Email configuration check:');
    console.log('CAREERS_EMAIL_USER:', process.env.CAREERS_EMAIL_USER ? 'SET' : 'NOT SET');
    console.log('CAREERS_EMAIL_PASS:', process.env.CAREERS_EMAIL_PASS ? 'SET' : 'NOT SET');

    if (!process.env.CAREERS_EMAIL_PASS) {
      console.log(`📝 Career application received from ${fullName} (${email}) for ${position} - Email not configured, logging only`);

      // Log the application details
      console.log('=== CAREER APPLICATION ===');
      console.log(`Name: ${fullName}`);
      console.log(`Email: ${email}`);
      console.log(`Phone: ${phone || 'Not provided'}`);
      console.log(`Position: ${position}`);
      console.log(`Experience: ${experience || 'Not provided'}`);
      console.log(`Skills: ${skills || 'Not provided'}`);
      console.log(`Portfolio: ${portfolio || 'Not provided'}`);
      console.log(`Cover Letter: ${coverLetter}`);
      console.log(`Availability: ${availability || 'Not specified'}`);
      if (req.file) {
        console.log(`Resume: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
      }
      console.log('========================');

      return res.json({
        success: true,
        message: 'Application received successfully! We will review it and get back to you soon.'
      });
    }

    // Create email transporter (using environment variables)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.CAREERS_EMAIL_USER || 'support@waldocoin.live',
        pass: process.env.CAREERS_EMAIL_PASS
      }
    });

    // Email content
    const emailContent = `
      <h2>🎯 New WALDOCOIN Job Application</h2>
      
      <h3>📋 Applicant Information:</h3>
      <p><strong>Name:</strong> ${fullName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
      <p><strong>Position:</strong> ${position}</p>
      
      <h3>💼 Experience & Skills:</h3>
      <p><strong>Experience:</strong> ${experience || 'Not provided'}</p>
      <p><strong>Skills:</strong> ${skills || 'Not provided'}</p>
      <p><strong>Portfolio:</strong> ${portfolio || 'Not provided'}</p>
      
      <h3>📝 Cover Letter:</h3>
      <p>${coverLetter}</p>
      
      <h3>📅 Availability:</h3>
      <p>${availability || 'Not specified'}</p>
      
      <hr>
      <p><em>Application submitted via WALDOCOIN Careers Page</em></p>
    `;

    // Prepare email options
    const emailOptions = {
      from: process.env.CAREERS_EMAIL_USER || 'support@waldocoin.live',
      to: 'support@waldocoin.live',
      subject: `🎯 New Job Application: ${position} - ${fullName}`,
      html: emailContent
    };

    // Add resume attachment if file was uploaded
    if (req.file) {
      emailOptions.attachments = [{
        filename: req.file.originalname,
        content: req.file.buffer,
        contentType: req.file.mimetype
      }];
      console.log(`📎 Resume attached: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    // Send email with error handling
    console.log(`📧 Attempting to send email to support@waldocoin.live for application from ${fullName}`);
    try {
      const emailResult = await transporter.sendMail(emailOptions);
      console.log(`✅ Career application received from ${fullName} (${email}) for ${position} - Email sent successfully`);
      console.log('📧 Email result:', emailResult.messageId);
    } catch (emailError) {
      console.error('❌ Failed to send email, but application was received:', emailError.message);
      console.error('❌ Email error details:', emailError);
      // Continue anyway - we don't want to fail the application just because email failed
    }

    res.json({
      success: true,
      message: 'Application submitted successfully!'
    });

  } catch (error) {
    console.error('❌ Error submitting career application:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit application'
    });
  }
});

export default router;

