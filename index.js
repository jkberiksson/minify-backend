import express from 'express';
import cors from 'cors';
import multer from 'multer';
import archiver from 'archiver';
import Ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());

// Create uploads folder if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Multer configuration
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed!'), false);
        }
    },
});

// Function to extract video metadata
function getVideoMetadata(inputVideoPath) {
    return new Promise((resolve, reject) => {
        Ffmpeg.ffprobe(inputVideoPath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                resolve({
                    duration: metadata.format.duration,
                    bitrate: parseInt(metadata.format.bit_rate, 10) / 1000,
                });
            }
        });
    });
}

app.get('/', (req, res) => {
    res.send({ msg: 'hello from /' });
});

// Upload route
app.post('/upload-video', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json('No file uploaded.');
    }

    const inputVideoPath = path.join('uploads', req.file.filename);
    const fileSizeMB = fs.statSync(inputVideoPath).size / (1024 * 1024);

    let videoMetadata;
    try {
        videoMetadata = await getVideoMetadata(inputVideoPath);
    } catch (err) {
        return res.status(500).json('Error retrieving video metadata');
    }

    const videoDuration = videoMetadata.duration;

    const qualityPercentage = parseInt(req.body.quality) || 50;
    const newFileSizeMB = fileSizeMB * (qualityPercentage / 100);

    const newBitrate = Math.floor((newFileSizeMB * 8 * 1024) / videoDuration);

    const timestamp = Date.now();
    const outputVideoPath = path.join('uploads', `compressed_${timestamp}.mp4`);
    const screenshotPath = path.join('uploads', `thumbnail_${timestamp}.jpg`);

    console.log('Compression started...');

    // Start compressionj
    Ffmpeg(inputVideoPath)
        .output(outputVideoPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate(`${newBitrate}k`)
        .outputOptions('-b:v', `${newBitrate}k`)
        .audioBitrate('128k')
        .outputOptions(['-preset fast', '-g 50'])
        .outputFormat('mp4')
        .on('end', async () => {
            console.log('Compression completed. Generating thumbnail...');

            // Create thumbnail after compression, at the start of the video
            Ffmpeg(inputVideoPath)
                .seek(0)
                .frames(1)
                .output(screenshotPath)
                .on('end', () => {
                    console.log('Thumbnail generated successfully.');

                    // Create a zip stream
                    const zipStream = archiver('zip', { zlib: { level: 9 } });

                    res.setHeader('Content-Disposition', 'attachment; filename="video_and_thumbnail.zip"');
                    res.setHeader('Content-Type', 'application/zip');

                    // Pipe the zip stream to the response
                    zipStream.pipe(res);
                    zipStream.append(fs.createReadStream(outputVideoPath), { name: 'compressed_video.mp4' });
                    zipStream.append(fs.createReadStream(screenshotPath), { name: 'thumbnail.jpg' });

                    zipStream.finalize();

                    zipStream.on('error', (err) => {
                        console.error('Error creating zip file:', err);
                        res.status(500).json('Error creating zip file.');
                    });

                    zipStream.on('end', () => {
                        console.log('ZIP file sent successfully.');
                        // Clean up the uploaded files
                        [inputVideoPath, outputVideoPath, screenshotPath].forEach((file) => {
                            if (fs.existsSync(file)) {
                                fs.unlinkSync(file);
                            }
                        });
                    });
                })
                .on('error', (err) => {
                    console.error('Error generating thumbnail:', err);
                    res.status(500).send('Error generating thumbnail');
                })
                .run();
        })
        .on('error', (err) => {
            console.error('Error during compression:', err);
            res.status(500).send('Error during compression');
        })
        .run();
});

app.listen(PORT, () => {
    console.log(`App running on port ${PORT}`);
});
