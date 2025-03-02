/**
 * Simple ID3 tag reader to extract metadata from MP3 files
 * This implementation reads ID3v1 and ID3v2 tags for artist and title information
 */

 class ID3TagReader {
    constructor() {
        this.reset();
    }

    reset() {
        this.title = "";
        this.artist = "";
        this.album = "";
        this.year = "";
        this.comment = "";
        this.genre = "";
    }

    /**
     * Read metadata from MP3 file URL
     * @param {string} url - Path to the MP3 file
     * @returns {Promise} Promise that resolves with metadata object
     */
    async readTags(url) {
        this.reset();
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch file');
            
            const arrayBuffer = await response.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            
            // Try to read ID3v2 tags first (more modern, more info)
            const hasID3v2 = this.hasID3v2(bytes);
            if (hasID3v2) {
                this.parseID3v2(bytes);
            }
            
            // If we don't have title/artist from ID3v2, try ID3v1
            if (!this.title || !this.artist) {
                const hasID3v1 = this.hasID3v1(bytes);
                if (hasID3v1) {
                    this.parseID3v1(bytes);
                }
            }
            
            // If still no metadata, try to extract from filename
            if (!this.title || !this.artist) {
                this.extractFromFilename(url);
            }
            
            return {
                title: this.title || "Unknown Title",
                artist: this.artist || "Unknown Artist",
                album: this.album || "",
                year: this.year || "",
                comment: this.comment || "",
                genre: this.genre || ""
            };
            
        } catch (error) {
            console.error('Error reading MP3 tags:', error);
            return {
                title: "Unknown Title",
                artist: "Unknown Artist",
                album: "",
                year: "",
                comment: "",
                genre: ""
            };
        }
    }
    
    /**
     * Check if file has ID3v1 tags
     */
    hasID3v1(bytes) {
        // ID3v1 tags are at the end of the file (last 128 bytes)
        // and start with "TAG" identifier
        if (bytes.length < 128) return false;
        
        const tagStart = bytes.length - 128;
        return bytes[tagStart] === 84 && // T
               bytes[tagStart + 1] === 65 && // A
               bytes[tagStart + 2] === 71; // G
    }
    
    /**
     * Parse ID3v1 tags
     */
    parseID3v1(bytes) {
        const tagStart = bytes.length - 128;
        
        // Extract title (30 bytes)
        this.title = this.title || this.decodeString(bytes.slice(tagStart + 3, tagStart + 33));
        
        // Extract artist (30 bytes)
        this.artist = this.artist || this.decodeString(bytes.slice(tagStart + 33, tagStart + 63));
        
        // Extract album (30 bytes)
        this.album = this.album || this.decodeString(bytes.slice(tagStart + 63, tagStart + 93));
        
        // Extract year (4 bytes)
        this.year = this.year || this.decodeString(bytes.slice(tagStart + 93, tagStart + 97));
        
        // Extract comment (30 bytes, but could be 28 if track number exists)
        this.comment = this.comment || this.decodeString(bytes.slice(tagStart + 97, tagStart + 127));
        
        // Extract genre (1 byte)
        this.genre = this.genre || this.getGenreName(bytes[tagStart + 127]);
    }
    
    /**
     * Check if file has ID3v2 tags
     */
    hasID3v2(bytes) {
        // ID3v2 tags are at the beginning of the file
        // and start with "ID3" identifier
        if (bytes.length < 10) return false;
        
        return bytes[0] === 73 && // I
               bytes[1] === 68 && // D
               bytes[2] === 51; // 3
    }
    
    /**
     * Parse ID3v2 tags
     */
    parseID3v2(bytes) {
        // Get ID3v2 version
        const majorVersion = bytes[3];
        
        // Get tag size (last 4 bytes of header)
        const size = this.getID3v2Size(bytes.slice(6, 10));
        
        if (majorVersion <= 4) { // Support ID3v2.2, ID3v2.3, and ID3v2.4
            let offset = 10; // Skip the header
            
            // Read all frames until we reach the tag end
            while (offset < size + 10) {
                let frameID, frameSize, frameHeaderSize;
                
                if (majorVersion === 2) { // ID3v2.2
                    frameID = this.decodeString(bytes.slice(offset, offset + 3));
                    frameSize = bytes[offset + 3] * 65536 + bytes[offset + 4] * 256 + bytes[offset + 5];
                    frameHeaderSize = 6;
                } else { // ID3v2.3 and ID3v2.4
                    frameID = this.decodeString(bytes.slice(offset, offset + 4));
                    
                    if (majorVersion === 3) { // ID3v2.3
                        frameSize = bytes[offset + 4] * 16777216 + bytes[offset + 5] * 65536 + 
                                    bytes[offset + 6] * 256 + bytes[offset + 7];
                    } else { // ID3v2.4
                        frameSize = this.getID3v2Size(bytes.slice(offset + 4, offset + 8));
                    }
                    
                    frameHeaderSize = 10;
                }
                
                // Skip empty frames
                if (frameID === "" || frameSize === 0) {
                    offset += frameHeaderSize;
                    continue;
                }
                
                // Parse frame content
                const frameContent = bytes.slice(offset + frameHeaderSize, offset + frameHeaderSize + frameSize);
                
                // ID3v2.2 has 3-character frame IDs, ID3v2.3+ has 4-character IDs
                if ((majorVersion === 2 && frameID === "TT2") || frameID === "TIT2") {
                    this.title = this.decodeTextFrame(frameContent, majorVersion);
                }
                else if ((majorVersion === 2 && frameID === "TP1") || frameID === "TPE1") {
                    this.artist = this.decodeTextFrame(frameContent, majorVersion);
                }
                else if ((majorVersion === 2 && frameID === "TAL") || frameID === "TALB") {
                    this.album = this.decodeTextFrame(frameContent, majorVersion);
                }
                else if ((majorVersion === 2 && frameID === "TYE") || frameID === "TYER") {
                    this.year = this.decodeTextFrame(frameContent, majorVersion);
                }
                else if ((majorVersion === 2 && frameID === "COM") || frameID === "COMM") {
                    this.comment = this.decodeCommentFrame(frameContent, majorVersion);
                }
                
                // Move to next frame
                offset += frameHeaderSize + frameSize;
            }
        }
    }
    
    /**
     * Get ID3v2 tag size from header
     */
    getID3v2Size(bytes) {
        // The 4 bytes are all 7-bit, so the high bit is ignored (0xxxxxxx)
        return ((bytes[0] & 0x7F) * 2097152) + // 2^21
               ((bytes[1] & 0x7F) * 16384) +   // 2^14
               ((bytes[2] & 0x7F) * 128) +     // 2^7
               (bytes[3] & 0x7F);
    }
    
    /**
     * Decode text frame content
     */
    decodeTextFrame(bytes, version) {
        // The first byte is the encoding
        const encoding = bytes[0];
        let content = bytes.slice(1);
        
        // Try to decode the string based on encoding
        if (encoding === 0) { // ISO-8859-1
            return this.decodeString(content);
        } else if (encoding === 1) { // UTF-16 with BOM
            return this.decodeUTF16(content);
        } else if (encoding === 3) { // UTF-8
            return new TextDecoder('utf-8').decode(content);
        }
        
        // Default fallback
        return this.decodeString(content);
    }
    
    /**
     * Decode comment frame content
     */
    decodeCommentFrame(bytes, version) {
        // The first byte is the encoding
        const encoding = bytes[0];
        
        // Next 3 bytes are the language
        const language = this.decodeString(bytes.slice(1, 4));
        
        // Then a null-terminated short description, then the actual comment
        let content = bytes.slice(4);
        
        // Find the null terminator to separate description from comment
        let nullPos = 0;
        if (encoding === 0 || encoding === 3) { // ISO-8859-1 or UTF-8
            while (nullPos < content.length && content[nullPos] !== 0) {
                nullPos++;
            }
            content = content.slice(nullPos + 1); // Skip the null terminator
        } else if (encoding === 1) { // UTF-16
            while (nullPos < content.length - 1 && !(content[nullPos] === 0 && content[nullPos + 1] === 0)) {
                nullPos += 2;
            }
            content = content.slice(nullPos + 2); // Skip the 2-byte null terminator
        }
        
        // Decode the actual comment
        if (encoding === 0) { // ISO-8859-1
            return this.decodeString(content);
        } else if (encoding === 1) { // UTF-16 with BOM
            return this.decodeUTF16(content);
        } else if (encoding === 3) { // UTF-8
            return new TextDecoder('utf-8').decode(content);
        }
        
        // Default fallback
        return this.decodeString(content);
    }
    
    /**
     * Decode UTF-16 string with BOM
     */
    decodeUTF16(bytes) {
        if (bytes.length < 2) return "";
        
        // Check for BOM to determine endianness
        let littleEndian = false;
        if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
            littleEndian = true;
            bytes = bytes.slice(2); // Skip BOM
        } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
            bytes = bytes.slice(2); // Skip BOM
        }
        
        // Create a Uint16Array view using the correct endianness
        const uint16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const decoder = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be');
        
        return decoder.decode(uint16);
    }
    
    /**
     * Decode ISO-8859-1 string
     */
    decodeString(bytes) {
        // Trim nulls and control characters
        let end = bytes.length;
        while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] < 32)) {
            end--;
        }
        
        if (end === 0) return "";
        
        // Convert ISO-8859-1 bytes to string
        let result = "";
        for (let i = 0; i < end; i++) {
            if (bytes[i] > 0) {
                result += String.fromCharCode(bytes[i]);
            }
        }
        
        return result.trim();
    }
    
    /**
     * Get ID3v1 genre name from genre code
     */
    getGenreName(code) {
        const genres = [
            "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
            "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae",
            "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks",
            "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion",
            "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip",
            "Gospel", "Noise", "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative",
            "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial",
            "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult",
            "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native US", "Cabaret",
            "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal",
            "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock"
        ];
        
        if (code >= 0 && code < genres.length) {
            return genres[code];
        }
        
        return "";
    }
    
    /**
     * Extract title and artist from filename
     */
    extractFromFilename(url) {
        // Get filename from URL
        const filename = url.split('/').pop().split('.')[0];
        
        // Try to split by common separators: " - ", "-", "_"
        let parts = [];
        if (filename.includes(" - ")) {
            parts = filename.split(" - ");
        } else if (filename.includes("-")) {
            parts = filename.split("-");
        } else if (filename.includes("_")) {
            parts = filename.split("_");
        }
        
        if (parts.length >= 2) {
            // Assume format is "Artist - Title" or "Title - Artist"
            // We'll guess that artist is the shorter string in most cases
            if (parts[0].length < parts[1].length) {
                this.artist = this.artist || parts[0].trim();
                this.title = this.title || parts[1].trim();
            } else {
                this.artist = this.artist || parts[1].trim();
                this.title = this.title || parts[0].trim();
            }
        } else {
            // Just use the filename as the title
            this.title = this.title || filename.trim();
        }
    }
}

// Create a global instance
const id3TagReader = new ID3TagReader();